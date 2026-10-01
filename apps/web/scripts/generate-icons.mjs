// Rasterizes src/app/icon.svg into the PNG icons the manifest, iOS and push notifications need.
// Run from apps/web after changing the logo: node scripts/generate-icons.mjs   (the PNGs are committed)
import {Buffer} from 'node:buffer';
import {mkdir, readFile} from 'node:fs/promises';
import {fileURLToPath, URL} from 'node:url';
import sharp from 'sharp';
const root = new URL('../', import.meta.url), out = new URL('public/icons/', root);
const svg = await readFile(new URL('src/app/icon.svg', root), 'utf8');
const background = /<rect[^>]*fill="(#[0-9a-fA-F]{3,8})"/.exec(svg)?.[1], glyph = /<path[^>]*\sd="([^"]+)"[^>]*fill="(#[0-9a-fA-F]{3,8})"/.exec(svg);
if (!background || !glyph) throw new Error('icon.svg must contain a filled <rect> background and a filled <path> glyph');
// scale < 1 shrinks the glyph around the centre; maskable icons keep it inside the central 80 % safe zone.
const compose = ({fill = background, color = glyph[2], scale = 1}) => Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">' + (fill ? '<rect width="192" height="192" fill="' + fill + '"/>' : '')
  + '<path transform="translate(96 96) scale(' + scale + ') translate(-96 -96)" d="' + glyph[1] + '" fill="' + color + '"/></svg>');
const icons = [
  ['icon-192.png', 192, Buffer.from(svg)],
  ['icon-512.png', 512, Buffer.from(svg)],
  ['maskable-512.png', 512, compose({scale: 0.78})],
  // iOS rounds the corners itself and paints transparency black, so the square is fully filled.
  ['apple-touch-icon-180.png', 180, compose({scale: 0.9})],
  // Android status-bar badge: only the alpha channel is used.
  ['badge-96.png', 96, compose({fill: null, color: '#ffffff', scale: 1.25})]
];
await mkdir(out, {recursive: true});
for (const [name, size, source] of icons) {
  await sharp(source, {density: 72 * size / 192 * 2}).resize(size, size).png({compressionLevel: 9}).toFile(fileURLToPath(new URL(name, out)));
  console.log('public/icons/' + name, size + 'x' + size);
}
