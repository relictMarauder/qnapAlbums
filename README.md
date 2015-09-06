# qnapAlbums
qnapAlbums is the tool for save photo/video albums(from Photo and Video Stations) as folders with softLinks to the media files

Backup/Restore functionality ist unstable

Tested on QNAP-470 firmware v4.1.x

# Quick start
 The tool must be installed on QNAP directly
## Prerequisites
   * Install NodeJs (https://github.com/jupe/QPKG-NodeJS)
   *  Clone repository

        git clone

## Node.js
 * Install dependencies

    npm install

 * Run qnapAlbums

    node ./qnapAlbums.js

      Usage: app <option> [parameter]

        Options:

            -h, --help                output usage information
            -V, --version             output the version number
            -v, --video               process video albums
            -p, --photo               process photo albums
            -e, --export [albumName]  export  albums to file
            -i, --import [fileName]   import  albums from file
            -l, --list [albumName]    list of albums/content of album if album name is defined
            -s, --save <path>         export  albums as Folders with softlinks to elements


* Example:
  -  `node ./qnapAlbums.js -p -v -s ./albums` save photo and video albums to folder ./albums
  -  `node ./qnapAlbums.js -v -s ./videoAlbums` save only video albums to folder ./videoAlbums
  -  `node ./qnapAlbums.js -p -s ./videoAlbums` save only photo albums to folder ./photoAlbums