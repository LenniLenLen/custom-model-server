const fs = require('fs');
const archiver = require('archiver');


module.exports = async function buildPack() {
console.log('Building pack.zip...');


// Create directories
if (!fs.existsSync('public-pack')) fs.mkdirSync('public-pack');


const output = fs.createWriteStream('public-pack/pack.zip');
const archive = archiver('zip');
archive.pipe(output);


archive.directory('pack-base/', false);
archive.directory('models/', 'assets/minecraft/models/custom/');


await archive.finalize();
console.log('pack.zip built');
};