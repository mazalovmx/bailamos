import sharp, {type Metadata} from 'sharp';
import {MediaError} from './errors';
import {heicEnabled, maxDimension, maxPixels} from './config';
import {FORMATS, WIDTHS, contentTypes, type Format, type Width} from './keys';
export type ProcessedFile = {width: Width; format: Format; body: Buffer; contentType: string};
export type Processed = {width: number; height: number; bytes: number; source: string; files: ProcessedFile[]};
// libvips refuses images above limitInputPixels as soon as it has read the header.
const tooManyPixels = (error: unknown) => error instanceof Error && /pixel limit/i.test(error.message);
/**
 * Turns an untrusted upload into safe derivatives.
 * - The real type comes from the decoder (magic bytes), never from the client MIME or file name.
 * - Dimensions are checked from the header before any pixel is decoded; `limitInputPixels` guards the decode itself.
 * - Output is re-encoded without metadata, so EXIF, GPS and embedded profiles never reach visitors;
 *   orientation is applied first so the picture does not turn once the tag is gone.
 */
export async function processImage(input: Buffer): Promise<Processed> {
  const limitInputPixels = maxPixels();
  const open = () => sharp(input, {limitInputPixels, failOn: 'error', sequentialRead: true, animated: false});
  let meta: Metadata;
  try {meta = await open().metadata();} catch (error) {throw tooManyPixels(error) ? new MediaError('MEDIA_DIMENSIONS', 400) : new MediaError('MEDIA_TYPE', 415);}
  // AVIF and HEIC share the HEIF container; the codec tells them apart.
  const source = meta.format === 'heif' ? (meta.compression === 'av1' ? 'avif' : 'heic') : String(meta.format);
  if (!['jpeg', 'png', 'webp', 'avif', ...(heicEnabled() ? ['heic'] : [])].includes(source)) throw new MediaError('MEDIA_TYPE', 415);
  const {width, height} = meta;
  if (!width || !height) throw new MediaError('MEDIA_TYPE', 415);
  if (width > maxDimension() || height > maxDimension() || width * height > limitInputPixels) throw new MediaError('MEDIA_DIMENSIONS', 400);
  const files: ProcessedFile[] = [];
  let largest = {width: 0, height: 0, bytes: 0};
  try {
    const base = open().rotate();
    for (const target of WIDTHS) for (const format of FORMATS) {
      const pipeline = base.clone().resize({width: target, withoutEnlargement: true});
      const {data, info} = await (format === 'avif' ? pipeline.avif({quality: 50, effort: 3}) : pipeline.webp({quality: 80}))
        .toBuffer({resolveWithObject: true});
      files.push({width: target, format, body: data, contentType: contentTypes[format]});
      if (format === 'webp' && info.width >= largest.width) largest = {width: info.width, height: info.height, bytes: data.length};
    }
  } catch (error) {
    if (tooManyPixels(error)) throw new MediaError('MEDIA_DIMENSIONS', 400);
    // Truncated or deliberately malformed data that passed the header check.
    throw new MediaError('MEDIA_TYPE', 415);
  }
  return {...largest, source, files};
}
