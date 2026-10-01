import {actor, ApiError, viewer} from '../api';
import {rateLimit, type RateLimitOptions} from '../rate-limit';
import {requireSearcher} from './search';
export const noStore = {'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex'};
export async function limited(key: string, options: RateLimitOptions) {
  if (!(await rateLimit('matching:' + key, options)).ok) throw new ApiError('RATE_LIMITED', 429);
}
/** Reads: signed in, verified, not banned, visible profile, at least one own lookingFor skill. */
export async function searchViewer(request: Request) {
  return requireSearcher(await viewer(request));
}
/** Mutations: the same, plus the same-origin check done by actor(). */
export async function searchActor(request: Request) {
  return requireSearcher(await actor(request));
}
/** Safety actions and own settings need a profile but not partner-search eligibility. */
export async function profileActor(request: Request) {
  const user = await actor(request);
  if (!user.profile) throw new ApiError('PROFILE_REQUIRED', 403);
  return {userId: user.id, profileId: user.profile.id};
}
