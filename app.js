#!/usr/bin/env node
var qnapAlbumsMgmr = require('commander');
var mysql = require('mysql');
var Promise = require("bluebird");
var fs = Promise.promisifyAll(require("fs-extra"));
var path = require('path');
var moment = require('moment');

var mountPoint = "/share/CACHEDEV1_DATA/";
qnapAlbumsMgmr.version('0.0.1')
    .usage('<option> [parameter]')
    .option("-v, --video", "process video albums")
    .option("-p, --photo", "process photo albums")
    .option("-e, --export [albumName]", "export  albums to file")
    .option("-i, --import [fileName]", "import  albums from file")
    .option("-l, --list [albumName]", "list of albums/content of album if album name is defined")
    .option("-s, --save <path>", "export  albums as Folders with softlinks on elements")
    .parse(process.argv);


var connection = mysql.createConnection({
    host: 'localhost',
    port: '3310',
    user: 'read',
    password: 'read',
    database: 's01'
});

var conn = Promise.promisifyAll(connection);
conn
    .connectAsync()
    .then(function () {
        if (qnapAlbumsMgmr.list && (qnapAlbumsMgmr.video || qnapAlbumsMgmr.photo) ) {
            return getListOfAlbum(qnapAlbumsMgmr.list);
        }
        if (qnapAlbumsMgmr.export && (qnapAlbumsMgmr.video || qnapAlbumsMgmr.photo)) {
            return exportToFile(qnapAlbumsMgmr.export);
        }
        if (qnapAlbumsMgmr.import && (qnapAlbumsMgmr.video || qnapAlbumsMgmr.photo)) {
            return importAlbums(qnapAlbumsMgmr.import);
        }
        if (qnapAlbumsMgmr.save && (qnapAlbumsMgmr.video || qnapAlbumsMgmr.photo)) {
            if (qnapAlbumsMgmr.save == true) {
                console.log("please define path for saving ")
            }
            else {
                return synchronizeWithFolder(qnapAlbumsMgmr.save)
            }
        }
        qnapAlbumsMgmr.help();
    })
    .catch(AlbumNotFoundError, function (error) {
        console.error('Album ' + error.extra + 'is  not found');
        process.exit(1);
    })
    .then(function () {
        process.exit(0);
        console.log("end");
    });


var queryStrGetAllPictureForAlbumByName = 'SELECT pt.*, dt.cFullPath FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId INNER JOIN pictureAlbumTable pa ON pa.iPhotoAlbumId=ptAlb.iPhotoAlbumId INNER JOIN dirTable dt ON dt.iDirId=pt.iDirId where pa.cAlbumTitle="{0}"';
var queryStrGetFroAlbumById = 'SELECT pt.* FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId where ptAlb.iPhotoAlbumId={0}';
var queryStrGetPictureAlbumByName = 'SELECT * FROM pictureAlbumTable where cAlbumTitle="{0}"';
var queryStrGetAllPicureAlbums = 'SELECT * FROM pictureAlbumTable';
var queryStrGetAllVideosForAlbumByName = 'SELECT pt.*, dt.cFullPath FROM videoTable pt INNER JOIN videoAlbumMapping ptAlb ON pt.iVideoId=ptAlb.iVideoId INNER JOIN videoAlbumTable pa ON pa.iVideoAlbumId=ptAlb.iVideoAlbumId INNER JOIN dirTable dt ON dt.iDirId=pt.iDirId where pa.cAlbumTitle="{0}"';
var queryStrGetAllVideosFromAlbumById = 'SELECT pt.* FROM videoTable pt INNER JOIN videoAlbumMapping ptAlb ON pt.iVideoId=ptAlb.iVideoId where ptAlb.iVideoAlbumId={0}';
var queryStrGetVideoAlbumByName = 'SELECT * FROM videoAlbumTable where cAlbumTitle="{0}"';
var queryStrGetAllVideoAlbums = 'SELECT * FROM videoAlbumTable';

function synchronizeWithFolder(syncPath) {
    return getAlbums()
        .map(function (albumRow) {
            console.log("Synchronize album " + albumRow.cAlbumTitle);
            return getAlbumItems(albumRow)
                .then(function (itemRows) {
                    var exportFolder = path.join(syncPath + albumRow.cAlbumTitle.replace("[/\\:'\"]", "_"), "/");
                    return fs
                        .statAsync(exportFolder)
                        .then(function () {
                            console.log("delete existed folder "+exportFolder);
                            return rmdir(exportFolder);
                        })
                        .catch(function () {
                            console.log("folder "+exportFolder+" don't exist")
                        })
                        .then(function () {
                            console.log("create folder "+exportFolder);
                            return fs.mkdirsAsync(exportFolder)
                        })
                        .then(function () {
                            console.log("create symlinks for " + itemRows.length + " items in " + exportFolder);
                            return Promise
                                .map(itemRows, function (itemRow) {
                                    //console.log(exportFolder,pictureRow.cFileName);
                                    return fs.symlinkAsync(itemRow.cFullFileName, path.join(exportFolder, itemRow.cFileName))
                                });
                        })
                });
        })


}


function getAlbumItems(albumRow) {
    var queryStr = qnapAlbumsMgmr.video ? queryStrGetAllVideosForAlbumByName : queryStrGetAllPictureForAlbumByName;
    return conn
        .queryAsync(queryStr.replace('{0}', albumRow.cAlbumTitle))
        .spread(function (picturesRows, fields) {
            return picturesRows;
        })
        .map(function (pictureRow) {
            pictureRow.cFullFileName = path.join(mountPoint, pictureRow.cFullPath, pictureRow.cFileName);
            return pictureRow;
        })
}
function getAlbum(albumName) {
    var queryStr = qnapAlbumsMgmr.video ? queryStrGetVideoAlbumByName : queryStrGetPictureAlbumByName;
    return conn
        .queryAsync(queryStr)
        .spread(function (albumRows, fileds) {
            if (albumRows.length == 0) {
                throw new AlbumNotFoundError("Album " + albumName + " is not founded", albumName);
            }
            return albumRows[0];
        });
}


function getAlbums() {
    var queryStr = qnapAlbumsMgmr.video ? queryStrGetAllVideoAlbums : queryStrGetAllPicureAlbums;
    return conn
        .queryAsync(queryStr)
        .spread(function (albumRows, fileds) {
            console.log('Founded ' + albumRows.length + " albums");
            return albumRows;
        });
}

function exportAlbumToFile(albumRow) {
    var albumName = albumRow.cAlbumTitle;
    console.log("exporting " + albumName);
    return getAlbumItems(albumRow)
        .then(function (itemRows) {
            var exportFileName = albumName.replace("[/\\:'\"]", "_") + '_' + moment().toISOString() + ".dump";
            var dumpObj = {albumName: albumName, datum: moment().toISOString(), items: []};
            for (var i = 0, len = itemRows.length; i < len; i++) {
                dumpObj.items.push({fileName: itemRows[i].cFullFileName});
            }
            return fs.writeFileAsync(exportFileName, JSON.stringify(dumpObj, null, 1)).then(function () {
                console.log('Album "' + albumName + '" with  ' + itemRows.length + " items is exported to " + exportFileName);
            })
        });
}
function exportToFile(albumName) {
    if (albumName !== true) {
        return getAlbum(albumName).then(exportAlbumToFile);
    }
    else {
        return getAlbums()
            .map(exportAlbumToFile);
    }
}


function getListOfAlbum(albumName) {
    if (albumName !== true) {
        return getAlbum(albumName).then(
            function (albumRow) {
                var albumName = albumRow.cAlbumTitle;
                var queryStr = (qnapAlbumsMgmr.video ? queryStrGetAllVideosForAlbumByName : queryStrGetAllPictureForAlbumByName).replace('{0}', albumName);
                return conn
                    .queryAsync(queryStr)
                    .spread(function (itemRows, fields) {
                        console.log('Album ' + albumName + " has " + itemRows.length + " items:");
                        return itemRows
                    })
                    .map(function (itemRow) {
                        console.log("\t" + path.join(mountPoint, itemRow.cFullPath, itemRow.cFileName));
                    })
            }
        );

    }
    else {
        return getAlbums()
            .map(function (albumRow) {
                var queryStr = (qnapAlbumsMgmr.video ? queryStrGetAllVideosFromAlbumById : queryStrGetFroAlbumById).replace("{0}", albumRow.iPhotoAlbumId);
                return conn
                    .queryAsync(queryStr)
                    .spread(function (pictureRows, fields) {
                        console.log('Album "' + albumRow.cAlbumTitle + '" contains ' + pictureRows.length + ' items');
                    })
            })
    }
}

function importAlbums(albumName) {
    if (albumName === true) {
        return getAlbums().map(importAlbum).then(function (arraysOfCommands) {
            var arrayOfCommands = [];
            for (var i = 0, len = arraysOfCommands.length; i < len; i++) {
                arrayOfCommands = arrayOfCommands.concat(arraysOfCommands[i])
            }
            return arrayOfCommands;
        }).then(createImportCmd);
    }
    else {
        return getAlbum(albumName).then(importAlbum).then(createImportCmd);
    }
}

function createImportCmd(arrayOfCommands) {
    var cmdObj = {mymediadbcmd: arrayOfCommands};
    console.log('create batch command file "tmp_import_albums.cmd"');
    return fs.writeFileAsync('tmp_import_albums.cmd', JSON.stringify(cmdObj, null, 1))
}

function importAlbum(albumRow) {
    return getAlbumItems(albumRow)
        .then(function (itemRows) {
            console.log("prepare batch file for " + itemRows.length + ' items in album "' + albumRow.cAlbumTitle + '"');
            var arrayOfCommands = [];
            for (var i = 0, len = itemRows.length; i < len; i++) {
                arrayOfCommands.push({
                    command: qnapAlbumsMgmr.video ? "addToVideoAlbum" : "addToPicAlbum",
                    parameter: [
                        mountPoint,
                        qnapAlbumsMgmr.video ? albumRow.iVideoAlbumId.toString() : albumRow.iPhotoAlbumId.toString(),
                        qnapAlbumsMgmr.video ? itemRows[i].iVideoId.toString() : itemRows[i].iPictureId.toString(),
                        qnapAlbumsMgmr.video ? "2" :"1"
                    ]
                })
            }
            return arrayOfCommands;
        });


}

function rmfile(dir, file) {
    var p = path.join(dir, file);
    return fs
        .lstatAsync(p)
        .then(function (stat) {
            if (stat.isDirectory()) {
                return rmdir(p);
            }
            else {
                return fs.unlinkAsync(p)
            }
        })
}

function rmdir(dir) {
    return fs
        .readdirAsync(dir)
        .map(function (file) {
            return rmfile(dir, file);
        })
        .then(function () {
            return fs.rmdirAsync(dir);
        })
}


function AlbumNotFoundError(message, extra) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = message;
    this.extra = extra;
}

require('util').inherits(AlbumNotFoundError, Error);
