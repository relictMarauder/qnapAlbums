#!/usr/bin/env node
var qnapAlbumsMgmr = require('commander');
var mysql = require('mysql');
var Promise = require("bluebird");
var fs = Promise.promisifyAll(require("fs"));
var path = require('path');
var moment =require('moment');

var mountPoint = "/shares/CACHEDEV1_DATA/";
qnapAlbumsMgmr.version('0.0.1')
    .usage('<option> [parameter]')
    .option("-e, --export [albumName]", "export picture albums to file")
    .option("-i, --import [fileName]", "import picture albums from file")
    .option("-l, --list [albumName]", "list of albums/content of album if album name is defined")
    .option("-s, --save <path>", "export picture albums as Folders with softlinks on piktures")
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
        if (qnapAlbumsMgmr.list) {
            return getListOfAlbum(qnapAlbumsMgmr.list);
        }
        if (qnapAlbumsMgmr.export) {
            return exportToFile(qnapAlbumsMgmr.export);
        }
        if (qnapAlbumsMgmr.import){
            return importAlbums(qnapAlbumsMgmr.import);
        }
        if (qnapAlbumsMgmr.save){
            if (qnapAlbumsMgmr.save == true){
                console.log("please define path for saving ")
            }
            else{
                return synchronizeWithFolder(qnapAlbumsMgmr.save)
            }
        }
        qnapAlbumsMgmr.help();
    })
    .catch(AlbumNotFoundError, function(error){
        console.error('Album '+error.extra+'is  not found');
        process.exit(1);
     })
    .then(function () {
        process.exit(0);
        console.log("end");
    });


var queryStrGetAllPictureForAlbumByName = 'SELECT pt.*, dt.cFullPath FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId INNER JOIN pictureAlbumTable pa ON pa.iPhotoAlbumId=ptAlb.iPhotoAlbumId INNER JOIN dirTable dt ON dt.iDirId=pt.iDirId where pa.cAlbumTitle="{0}"';

function synchronizeWithFolder(syncPath) {
    return getAlbums()
        .map(function (albumRow) {
            console.log("Synchronize album " + albumRow.cAlbumTitle);
            return getAlbumPictures(albumRow)
                .then(function (pictureRows) {
                    var exportFolder = path.join(syncPath + albumRow.cAlbumTitle.replace("[/\\:'\"]", "_"),"/");
                    return fs
                        .statAsync(exportFolder)
                        .catch(function(){})
                        .then(function () {
                            //console.log("delete existed folder "+exportFolder);
                            return rmdir(exportFolder);
                        })
                        .then(function(){
                            //console.log("create folder "+exportFolder);
                            return fs.mkdirAsync(exportFolder)
                        })
                        .then(function () {
                            console.log("create symlinks for "+pictureRows.length+" pictures in "+exportFolder);
                            return Promise
                                .map(pictureRows,function (pictureRow) {
                                    //console.log(exportFolder,pictureRow.cFileName);
                                    return fs.symlinkAsync(pictureRow.cFullFileName,path.join(exportFolder,pictureRow.cFileName))
                                });
                        })
                });
        })


}


function getAlbumPictures(albumRow) {
    return conn
        .queryAsync(queryStrGetAllPictureForAlbumByName.replace('{0}', albumRow.cAlbumTitle))
        .spread(function (picturesRows, fields) {
            return picturesRows;
        })
        .map(function (pictureRow) {
            pictureRow.cFullFileName = path.join(mountPoint,pictureRow.cFullPath,pictureRow.cFileName);
            return pictureRow;
        })
}
function getAlbum(albumName) {
    return conn
        .queryAsync('SELECT * FROM pictureAlbumTable where cAlbumTitle="'+albumName+'"')
        .spread(function (albumRows, fileds) {
             if (albumRows.length == 0){
                 throw new AlbumNotFoundError("Album "+albumName+" is not founded",albumName);
             }
            return albumRows[0];
        });
}


function getAlbums() {
    return conn
        .queryAsync('SELECT * FROM pictureAlbumTable')
        .spread(function (albumRows, fileds) {
            console.log('Founded ' + albumRows.length + " albums");
            return albumRows;
        });
}

function exportAlbumToFile(albumRow) {
    var albumName = albumRow.cAlbumTitle;
    console.log("exporting " + albumName);
    return getAlbumPictures(albumRow)
        .then(function (pictureRows) {
            var exportFileName = albumName.replace("[/\\:'\"]", "_") +'_'+moment().toISOString()+ ".dump";
            var dumpObj = {albumName: albumName, datum: moment().toISOString(), pictures: []};
            for (var i = 0, len = pictureRows.length; i < len; i++) {
                dumpObj.pictures.push({fileName: pictureRows[i].cFullFileName});
            }
            return fs.writeFileAsync(exportFileName, JSON.stringify(dumpObj, null, 1)).then(function () {
                console.log('Album "' + albumName + '" with  ' + pictureRows.length + " pictures is exported to " + exportFileName);
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
    if (albumName !== true ) {
        return getAlbum(albumName).then(
            function(albumRow){
                var albumName =albumRow.cAlbumTitle;
                var queryStr = queryStrGetAllPictureForAlbumByName.replace('{0}', albumName);
                return conn
                    .queryAsync(queryStr)
                    .spread(function (picturesRows, fields) {
                        console.log('Album ' + albumName + " has " + picturesRows.length + " pictures:");
                        return picturesRows
                    })
                    .map(function (pictureRow) {
                        console.log("\t"+path.join(mountPoint,pictureRow.cFullPath,pictureRow.cFileName));
                    })
            }
        );

    }
    else {
        return getAlbums()
            .map(function (albumRow) {
                var queryStr = 'SELECT pt.* FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId where ptAlb.iPhotoAlbumId=' + albumRow.iPhotoAlbumId;
                return conn
                    .queryAsync(queryStr)
                    .spread(function (pictureRows, fields) {
                        console.log('Album "' + albumRow.cAlbumTitle + '" contains ' + pictureRows.length + ' pictures');
                    })
            })
    }
}

function importAlbums(albumName){
    if (albumName === true){
        return getAlbums().map(importAlbum).then(function(arraysOfCommands){
            var arrayOfCommands = [];
            for (var i = 0, len = arraysOfCommands.length; i < len; i++){
                arrayOfCommands=arrayOfCommands.concat(arraysOfCommands[i])
            }
            return arrayOfCommands;
        }).then(createImportCmd);
    }
    else{
        return getAlbum(albumName).then(importAlbum).then(createImportCmd);
    }
}

function createImportCmd(arrayOfCommands){
    var cmdObj = {mymediadbcmd: arrayOfCommands};
    console.log('create batch command file "tmp_import_albums.cmd"');
    return fs.writeFileAsync('tmp_import_albums.cmd', JSON.stringify(cmdObj, null, 1))
}

function importAlbum(albumRow){
    return getAlbumPictures(albumRow)
        .then(function(picureRows){
            console.log("prepare batch file for " + picureRows.length + ' pictures in album "'+albumRow.cAlbumTitle+'"');
            var arrayOfCommands = [];
            for (var i = 0, len = picureRows.length; i < len; i++) {
                arrayOfCommands.push({
                    command: "addToPicAlbum",
                    parameter: [mountPoint, albumRow.iPhotoAlbumId.toString(), picureRows[i].iPictureId.toString(), "1"]
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
};

require('util').inherits(AlbumNotFoundError, Error);

/*var selectedAlbumName = 'Dubai-2015';
 var selectedAlbumId;
 var conn = Promise.promisifyAll(connection);
 conn.connectAsync()
 /*
 .then(function(){
 return conn.queryAsync('SELECT * FROM pictureAlbumTable').spread(function(albumRows,fields){
 console.log('Finded '+albumRows.length+" albums");
 return albumRows;
 })
 .map(function(albumRow){
 //console.log('The album is: ', JSON.stringify(albumRow, null, 2));
 var queryStr = 'SELECT pt.* FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId where ptAlb.iPhotoAlbumId='+albumRow.iPhotoAlbumId;
 if (albumRow.cAlbumTitle==selectedAlbumName){
 selectedAlbumId=albumRow.iPhotoAlbumId;
 }
 return conn.queryAsync(queryStr)
 .spread( function(pictureRows,fields){
 console.log("Album \""+albumRow.cAlbumTitle + "\" has "+pictureRows.length+" pictures");

 });
 });
 })
 .then(function(){
 return findPhotosFronFileInDB("./listofFiles")
 })*/
/*.then(function () {
 return getListOfPicturesFroAlbum(selectedAlbumName)
 })
 .then(function () {
 process.exit(0);
 console.log("end");
 })

 function getListOfPicturesFroAlbum(albumName) {
 return conn.queryAsync('SELECT pt.*, dt.cFullPath FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId INNER JOIN pictureAlbumTable pa ON pa.iPhotoAlbumId=ptAlb.iPhotoAlbumId INNER JOIN dirTable dt ON dt.iDirId=pt.iDirId where pa.cAlbumTitle="' + albumName + '"').spread(function (pictureRows, fields) {
 for (var i = 0, len = pictureRows.length; i < len; i++) {
 console.log("/shares/" + pictureRows[i].cFullPath + pictureRows[i].cFileName)
 }
 })
 }
 function findPhotosFronFileInDB(fileListName) {
 return fs.readFileAsync(fileListName)
 .then(function (str) {
 return str.toString().split('\n');
 })
 .then(function (fileNames) {
 console.log("Start processing of " + fileNames.length + " files");
 return fileNames;
 })
 .map(findPhotoInDB)
 .then(function (pictureIds) {
 console.log("pictureIds:" + pictureIds.length);
 var arrayOfCommands = [];
 for (var i = 0, len = pictureIds.length; i < len; i++) {
 arrayOfCommands.push({
 command: "addToPicAlbum",
 parameter: ["/share/CACHEDEV1_DATA/", selectedAlbumId.toString(), pictureIds[i].toString(), "1"]
 })
 }
 var cmdObj = {mymediadbcmd: arrayOfCommands}
 return fs.writeFileAsync('tmp_cmd.cmd', JSON.stringify(cmdObj, null, 1))
 });
 }

 function findPhotoInDB(fileName) {
 fileName = fileName.replace('*', '');
 var queryStr = 'SELECT pt.* FROM pictureTable pt WHERE pt.cFileName=\"' + fileName + '\"';
 //console.log(queryStr)
 return conn.queryAsync(queryStr)
 .spread(function (fileObjs, fields) {
 if (fileObjs.length === 1) {
 //console.log('File '+fileName+' is found, pictureId: '+fileObjs[0].iPictureId)
 return fileObjs[0].iPictureId;
 }
 else {
 console.error('File ' + fileName + ' is not found:' + JSON.stringify(fileObjs, null, 2))
 }
 })
 .catch(function (error) {
 console.error('File ' + fileName + ' is not found, error:' + JSON.stringify(error, null, 2))
 });
 }


 /*
 function addPhotoToAlbum($photoId, $albumId){^M
 $type = self::MEDIA_TYPE_PHOTO;^M
 if(!is_array($photoId)){^M
 unset($returnArray);^M
 $photoId = escapeshellarg($photoId);^M
 $albumId = escapeshellarg($albumId);^M
 $command = "{$this->CMD} addToPicAlbum {$this->media_root} $albumId $photoId $type";^M
 $this->simpleExec($command, $returnArray, $returnVar);^M
 return array('status'=>$returnVar, 'output'=>$returnArray, 'commands'=>$this->getCommandHistory(), 'Queries'=>$this->getQueryHistory());^M
 }else{^M
 //do batch add photos^M
 $data = array();^M
 foreach($photoId as $photo){^M
 $data[] = array(^M
 "command"=>"addToPicAlbum",^M
 "parameter"=> array(^M
 "{$this->media_root}",^M
 "$albumId",^M
 "$photo",^M
 "$type"^M
 )^M
 );^M
 }^M
 $file = '/tmp/batch_addphoto_'.strtotime('now').'_'.mt_rand(100,999);^M
 file_put_contents($file, qnap_json_encode(array('mymediadbcmd'=>$data)));^M
 $command = "{$this->CMD} cmdFile $file";^M
 $this->simpleExec($command, $returnArray, $returnVar);^M
 return array('status'=>$returnVar, 'output'=>$returnArray, 'commands'=>$this->getCommandHistory(), 'Queries'=>$this->getQueryHistory());^M
 }^M
 }^M
 *

 /*connection.query('SELECT * FROM `pictureAlbumTable` LIMIT 100', function(err, albumRows, fields) {
 if (err) throw err;
 console.log('Finded '+albumRows.length+" Albums");
 for (var i = 0, len = albumRows.length; i < len; i++ ){
 var albumObj = albumRows[i];
 connection.query(' SELECT pt.cFileName FROM pictureTable pt INNER JOIN pictureAlbumMapping ptAlb ON pt.iPictureId=ptAlb.iMediaId where ptAlb.iPhotoAlbumId=3', function(err, pictureRows, fields) {
 console.log("Album :"+albumObj.cAlbumTitle + " with "+pictureRows.lenght);

 });
 }
 //  console.log('The solution is: ', JSON.stringify(rows, null, 2));
 });*/