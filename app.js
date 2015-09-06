#!/usr/bin/env node
var qnapAlbumsMgmr = require('commander');
var mysql = require('mysql');
var Promise = require("bluebird");
var fs = Promise.promisifyAll(require("fs-extra"));
var path = require('path');
var moment = require('moment');

var mountPoint = "/share/CACHEDEV1_DATA/";


qnapAlbumsMgmr
    .version('0.0.2')
    .usage('<option> [parameter]')
    .option("-v, --video", "process video albums")
    .option("-p, --photo", "process photo albums")
    .option("-e, --export [albumName]", "export  albums to file")
    .option("-i, --import [fileName]", "import  albums from file")
    .option("-l, --list [albumName]", "list of albums/content of album if album name is defined")
    .option("-s, --save <path>", "export  albums as Folders with softlinks to elements")
    .on("--help", function () {
        console.log('  Examples:');
        console.log('');
        console.log('    qnapAlbums -v -p -s   save videos and photo albums as folders with softlinks to elements');
        console.log('');
    })
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
    .then(function (param1) {
        if (qnapAlbumsMgmr.save == true) {
            console.log("please define path for saving ");
            return;
        }

        var videoScope =
        {
            processVideos: true,
            processPhotos: false,
            logPrefix: "Video"
        };
        var photoScope =
        {
            processVideos: true,
            processPhotos: false,
            logPrefix: "Photo"
        };
        var mainPromise = Promise.resolve();
        if (qnapAlbumsMgmr.save) {
            videoScope.savePath = qnapAlbumsMgmr.save;
            if (qnapAlbumsMgmr.video) {
                mainPromise = mainPromise.then(uppendArgument(synchronizeWithFolder, [qnapAlbumsMgmr.save, videoScope], true));
            }
            if (qnapAlbumsMgmr.photo) {
                mainPromise = mainPromise.then(uppendArgument(synchronizeWithFolder, [qnapAlbumsMgmr.save, photoScope], true));
            }
        } else if (qnapAlbumsMgmr.list) {
            if (qnapAlbumsMgmr.video) {
                photoScope.albumName = qnapAlbumsMgmr.list;
                mainPromise = mainPromise.then(uppendArgument(getListOfAlbum, [qnapAlbumsMgmr.list, videoScope], true))
            }
            if (qnapAlbumsMgmr.photo) {
                photoScope.albumName = qnapAlbumsMgmr.list;
                mainPromise = mainPromise.then(uppendArgument(getListOfAlbum, [qnapAlbumsMgmr.list, photoScope], true))
            }
        } else if (qnapAlbumsMgmr.import) {
            videoScope.albumName = qnapAlbumsMgmr.import;
            if (qnapAlbumsMgmr.video) {
                videoScope.albumName = qnapAlbumsMgmr.import;
                mainPromise = mainPromise.then(uppendArgument(importAlbums, [qnapAlbumsMgmr.import, videoScope], true));
            }
            if (qnapAlbumsMgmr.photo) {
                photoScope.albumName = qnapAlbumsMgmr.import;
                mainPromise = mainPromise.then(uppendArgument(importAlbums, [qnapAlbumsMgmr.import, photoScope], true));
            }
        } else if (qnapAlbumsMgmr.export) {
            if (qnapAlbumsMgmr.video) {
                videoScope.albumName = qnapAlbumsMgmr.export;
                mainPromise = mainPromise.then(uppendArgument(exportToFile, [qnapAlbumsMgmr.export, videoScope], true));
            }
            if (qnapAlbumsMgmr.photo) {
                photoScope.albumName = qnapAlbumsMgmr.export;
                mainPromise = mainPromise.then(uppendArgument(exportToFile, [qnapAlbumsMgmr.export, photoScope], true));
            }
        }

        if (!qnapAlbumsMgmr.photo && !qnapAlbumsMgmr.video) {
            qnapAlbumsMgmr.help();
        }
        return mainPromise.then(function () {
            console.log("Processing is done");
        });
    })
    .catch(AlbumNotFoundError, function (error) {
        console.error('Album ' + error.extra + 'is  not found');
        conn.end();
        process.exit(1);
    })
    .catch(function (error) {
        console.error(error);
        console.log(error.stack);
        conn.end();
        process.exit(1);
    })
    .then(function () {
        conn.end();
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

function synchronizeWithFolder(syncPath, scope) {
    return getAlbums(scope)
        .map(function (albumRow) {
            console.log("Synchronize album " + albumRow.cAlbumTitle);
            return getAlbumItems(albumRow, scope)
                .then(function (itemRows) {
                    var exportFolder = path.join(syncPath, albumRow.cAlbumTitle.replace("[/\\:'\"]", "_"), "/");
                    return fs
                        .statAsync(exportFolder)
                        .then(function () {
                            console.log("\tdelete existed folder " + exportFolder);
                            return rmdir(exportFolder);
                        })
                        .catch(function () {
                            console.log("\tfolder " + exportFolder + " don't exist")
                        })
                        .then(function () {
                            console.log("\tcreate folder " + exportFolder);
                            return fs.mkdirsAsync(exportFolder)
                        })
                        .then(function () {
                            console.log("\tcreate symlinks for " + itemRows.length + " items in " + exportFolder);
                            return Promise
                                .map(itemRows, function (itemRow) {
                                    //console.log(exportFolder,pictureRow.cFileName);
                                    return fs.symlinkAsync(itemRow.cFullFileName, path.join(exportFolder, itemRow.cFileName))
                                });
                        })
                });
        })
}


function getAlbumItems(albumRow, scope) {
    var queryStr = scope.processVideos ? queryStrGetAllVideosForAlbumByName : queryStrGetAllPictureForAlbumByName;
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
function getAlbum(albumName, scope) {
    var queryStr = scope.processVideos ? queryStrGetVideoAlbumByName : queryStrGetPictureAlbumByName;
    return conn
        .queryAsync(queryStr)
        .spread(function (albumRows, fileds) {
            if (albumRows.length == 0) {
                throw new AlbumNotFoundError(scope.logPrefix + " album " + albumName + " is not founded", albumName);
            }
            return albumRows[0];
        });
}


function getAlbums(scope) {
    var queryStr = scope.processVideos ? queryStrGetAllVideoAlbums : queryStrGetAllPicureAlbums;
    return conn
        .queryAsync(queryStr)
        .spread(function (albumRows, fileds) {
            console.log('Founded ' + albumRows.length + " " + scope.logPrefix + " albums");
            return albumRows;
        });
}

function exportAlbumToFile(albumRow, index, size, scope) {
    var albumName = albumRow.cAlbumTitle;
    console.log("exporting " + albumName);
    return getAlbumItems(albumRow, scope)
        .then(function (itemRows) {
            var exportFileName = albumName.replace("[/\\:'\"]", "_") + '_' + moment().format("YYYY-MM-DD_hh_mm_ss") + ".dump";
            var dumpObj = {albumName: albumName, datum: moment().toISOString(), items: []};
            for (var i = 0, len = itemRows.length; i < len; i++) {
                dumpObj.items.push({fileName: itemRows[i].cFullFileName});
            }
            return fs.writeFileAsync(exportFileName, JSON.stringify(dumpObj, null, 1)).then(function () {
                console.log(scope.logPrefix + ' album "' + albumName + '" with  ' + itemRows.length + " items is exported to " + exportFileName);
            })
        });
}
function exportToFile(albumName, scope) {
    if (albumName !== true) {
        return getAlbum(albumName, scope).then(uppendArgument(exportAlbumToFile, [0, 1, scope]));
    }
    else {
        return getAlbums(scope)
            .map(uppendArgument(exportAlbumToFile, scope));
    }
}


function getListOfAlbum(albumName, scope) {
    if (albumName !== true) {
        return getAlbum(albumName, scope).then(uppendArgument(getListOfOneAlbum, [0, 1, true, scope]));
    }
    else {
        return getAlbums(scope)
            .map(uppendArgument(getListOfOneAlbum, [false, scope]));

    }
}

function getListOfOneAlbum(albumRow, index, size, verbosePrint, scope) {
    var albumName = albumRow.cAlbumTitle;
    var queryStr = (scope.processVideos ? queryStrGetAllVideosForAlbumByName : queryStrGetAllPictureForAlbumByName).replace('{0}', albumName);
    return conn
        .queryAsync(queryStr)
        .spread(function (itemRows, fields) {
            console.log(scope.logPrefix + ' album ' + albumName + " contains " + itemRows.length + " items:");
            return itemRows
        })
        .map(function (itemRow) {
            if (verbosePrint) {
                console.log("\t" + path.join(mountPoint, itemRow.cFullPath, itemRow.cFileName));
            }
        })
}

function importAlbums(albumName, scope) {
    if (albumName === true) {
        return getAlbums(scope).map(uppendArgument(importAlbum, scope)).then(function (arraysOfCommands) {
            var arrayOfCommands = [];
            for (var i = 0, len = arraysOfCommands.length; i < len; i++) {
                arrayOfCommands = arrayOfCommands.concat(arraysOfCommands[i])
            }
            return arrayOfCommands;
        }).then(createImportCmd);
    }
    else {
        return getAlbum(albumName).then(uppendArgument(importAlbum, [0, 1, scope])).then(createImportCmd);
    }
}

function createImportCmd(arrayOfCommands) {
    var cmdObj = {mymediadbcmd: arrayOfCommands};
    console.log('create batch command file "tmp_import_albums.cmd"');
    return fs.writeFileAsync('tmp_import_albums.cmd', JSON.stringify(cmdObj, null, 1))
}

function importAlbum(albumRow, index, size, scope) {
    return getAlbumItems(albumRow, scope)
        .then(function (itemRows) {
            console.log("prepare batch file for " + itemRows.length + ' items in ' + scope.logPrefix + ' album "' + albumRow.cAlbumTitle + '"');
            var arrayOfCommands = [];
            for (var i = 0, len = itemRows.length; i < len; i++) {
                arrayOfCommands.push({
                    command: qnapAlbumsMgmr.video ? "addToVideoAlbum" : "addToPicAlbum",
                    parameter: [
                        mountPoint,
                        this.processVideos ? albumRow.iVideoAlbumId.toString() : albumRow.iPhotoAlbumId.toString(),
                        this.processVideos ? itemRows[i].iVideoId.toString() : itemRows[i].iPictureId.toString(),
                        this.processVideos ? "2" : "1"
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

function uppendArgument(fn, additionalsArguments, override) {
    return function () {
        var args = override ? [] : Array.prototype.slice.call(arguments);
        args = args.concat(additionalsArguments);
        return fn.apply(this, args);
    }
}

require('util').inherits(AlbumNotFoundError, Error);
