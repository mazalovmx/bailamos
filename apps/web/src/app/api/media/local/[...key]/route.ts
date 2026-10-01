import {storage, readStream} from '../../../../../lib/storage';
import {verifyLocalUpload} from '../../../../../lib/storage/local';
import {parseRawKey} from '../../../../../lib/media/keys';
// Upload endpoint of the local-disk storage driver. The HMAC-signed query string is the credential, exactly like an
// S3 presigned URL: it fixes the key, the content type, the size and the expiry. Not available when S3 is configured.
export const runtime = 'nodejs';
const refuse = (error: string, status: number) => Response.json({error}, {status});
export async function PUT(request: Request, {params}: {params: Promise<{key: string[]}>}) {
  try {
    const store = storage();
    if (store.driver !== 'local') return refuse('NOT_FOUND', 404);
    const key = (await params).key.join('/');
    if (!parseRawKey(key)) return refuse('FORBIDDEN', 403);
    const grant = verifyLocalUpload(key, new URL(request.url).searchParams);
    if (!grant) return refuse('FORBIDDEN', 403);
    if ((request.headers.get('content-type') || '').toLowerCase() !== grant.mime) return refuse('MEDIA_TYPE', 415);
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > grant.size) return refuse('MEDIA_TOO_LARGE', 413);
    if (!request.body) return refuse('INVALID_INPUT', 400);
    // The header can lie, so the stream itself is cut off at the signed size.
    const body = await readStream(request.body, grant.size);
    if (!body) return refuse('MEDIA_TOO_LARGE', 413);
    if (body.length !== grant.size) return refuse('INVALID_INPUT', 400);
    // A signed URL writes its object once.
    if (await store.exists(key)) return refuse('FORBIDDEN', 403);
    await store.putObject(key, body, grant.mime);
    return new Response(null, {status: 204});
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'media_local_upload_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return refuse('SERVER_ERROR', 500);
  }
}
