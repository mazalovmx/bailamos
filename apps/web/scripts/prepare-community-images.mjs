import sharp from 'sharp';
import {fileURLToPath,URL} from 'node:url';
const directory = new URL('../public/images/community/', import.meta.url);
for (const name of ['hero','classes','lesson','solo-jazz','lindy-hop','social']) {
  for (const width of [640,1280]) {
    await sharp(fileURLToPath(new URL(name+'.png',directory))).resize({width,withoutEnlargement:true}).webp({quality:82}).toFile(fileURLToPath(new URL(name+'-'+width+'.webp',directory)));
  }
}
console.log('Prepared responsive community images. Originals preserved.');
