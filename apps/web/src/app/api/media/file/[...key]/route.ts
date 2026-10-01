import {db} from '@dance/db';
import {storage} from '../../../../../lib/storage';
import {contentTypes, isBaseKey, parseVariantKey, variantKey} from '../../../../../lib/media/keys';
// Serves processed image variants only (never raw uploads). Keys are unique per upload, so responses are immutable.
// /api/media/file/<storageKey> without a variant suffix answers with the default 800px WebP.
export const runtime = 'nodejs';
const notFound = () => new Response(null, {status: 404, headers: {'Cache-Control': 'no-store'}});
export async function GET(_request: Request, {params}: {params: Promise<{key: string[]}>}) {
  try {
    const requested = (await params).key.join('/');
    const key = isBaseKey(requested) ? variantKey(requested, 800, 'webp') : requested;
    const variant = parseVariantKey(key);
    if (!variant) return notFound();
    // Media hidden by moderation is not served, even to someone who kept the direct link.
    const base = key.slice(0, key.lastIndexOf('/'));
    if (await db.mediaItem.findFirst({where: {storageKey: base, hiddenAt: {not: null}}, select: {id: true}})) return notFound();
    const publicBase = process.env.S3_PUBLIC_URL;
    if (publicBase) return new Response(null, {status: 307, headers: {
      Location: publicBase.replace(/\/+$/, '') + '/' + key, 'Cache-Control': 'public, max-age=3600'
    }});
    const object = await storage().getObject(key);
    if (!object) return notFound();
    return new Response(object.body, {headers: {
      // The type comes from the key we generated, not from anything the uploader said.
      'Content-Type': contentTypes[variant.format],
      ...(object.size !== undefined ? {'Content-Length': String(object.size)} : {}),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline'
    }});
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'media_serve_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return new Response(null, {status: 500, headers: {'Cache-Control': 'no-store'}});
  }
}
