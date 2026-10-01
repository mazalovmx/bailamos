import {ApiError, apiError} from '../api';
import {mediaFail} from '../media/http';
import {MediaError} from '../media/errors';
import {rateLimit, type RateLimitOptions} from '../rate-limit';
import {ContentError} from './content';
// A post body is far larger than the 16 KB the shared jsonBody allows, so the blog routes read with their own cap.
export const MAX_BODY_BYTES = 200_000;
export async function postBody(request: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > max) throw new ApiError('CONTENT_TOO_LARGE', 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > max) throw new ApiError('CONTENT_TOO_LARGE', 413);
  try {return JSON.parse(text);} catch {throw new ApiError('INVALID_INPUT', 400);}
}
export async function limited(key: string, options: RateLimitOptions) {
  if (!(await rateLimit(key, options)).ok) throw new ApiError('TOO_MANY_REQUESTS', 429);
}
export function blogFail(error: unknown) {
  if (error instanceof ContentError) return Response.json({error: error.code}, {status: error.code === 'CONTENT_TOO_LARGE' ? 413 : 400});
  if (error instanceof MediaError) return mediaFail(error);
  return apiError(error);
}
