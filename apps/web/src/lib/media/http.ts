import {apiError} from '../api';
import {clientIp, rateLimit, type RateLimitOptions} from '../rate-limit';
import {MediaError} from './errors';
/** Route-level error mapper: media errors keep their code and status, everything else goes through the shared apiError. */
export function mediaFail(error: unknown) {
  if (error instanceof MediaError) return Response.json({error: error.code}, {
    status: error.status, headers: error.retryAfter ? {'Retry-After': String(error.retryAfter)} : undefined
  });
  return apiError(error);
}
export async function limited(key: string, options: RateLimitOptions) {
  const result = await rateLimit(key, options);
  if (!result.ok) throw new MediaError('TOO_MANY_REQUESTS', 429, result.retryAfter);
}
export {clientIp};
