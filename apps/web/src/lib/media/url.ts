import {WIDTHS, variantKey, type Format, type Width} from './keys';
export type Variants = {src: string; avif: string; webp: string; widths: number[]};
/**
 * URL of one stored variant. On the server, S3_PUBLIC_URL (a CDN or public bucket URL) is used directly;
 * in the browser that variable is not available and the same-origin route answers with a redirect instead,
 * so client components should prefer the `sources` they receive from the server.
 */
export function mediaUrl(key: string, width: Width = 800, format: Format = 'webp') {
  const path = variantKey(key, width, format);
  const base = process.env.S3_PUBLIC_URL;
  return base ? base.replace(/\/+$/, '') + '/' + path : '/api/media/file/' + path;
}
/**
 * srcset strings for <picture>. All three widths are always stored, but an image is never enlarged, so when the
 * intrinsic width is known the list stops at the first variant that already holds the full image.
 */
export function variants(key: string, intrinsicWidth?: number | null): Variants {
  const full = intrinsicWidth && intrinsicWidth > 0 ? intrinsicWidth : Infinity;
  const widths = WIDTHS.filter((width, index) => index === 0 || WIDTHS[index - 1] < full);
  const srcset = (format: Format) => widths.map(width => mediaUrl(key, width, format) + ' ' + Math.min(width, full) + 'w').join(', ');
  return {
    src: mediaUrl(key, widths.includes(800) ? 800 : widths[widths.length - 1], 'webp'),
    avif: srcset('avif'), webp: srcset('webp'), widths: widths.map(width => Math.min(width, full))
  };
}
