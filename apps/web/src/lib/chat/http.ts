import {actor, ApiError, viewer} from '../api';
import type {Me} from './service';
// Chat needs a profile: conversations, blocks and messages all hang off Profile, not User.
/** Mutations: same-origin, verified email, not banned (actor), plus a profile. */
export async function chatActor(request: Request): Promise<Me> {
  const user = await actor(request);
  if (!user.profile) throw new ApiError('PROFILE_REQUIRED', 409);
  return {userId: user.id, profileId: user.profile.id, role: user.role, name: user.profile.name, schoolIds: user.schoolIds};
}
/** Reads: a ban cuts chat off completely, including reading and the live stream. */
export async function chatViewer(request: Request): Promise<Me> {
  const user = await viewer(request);
  if (!user) throw new ApiError('UNAUTHORIZED', 401);
  if (user.bannedAt) throw new ApiError('BANNED', 403);
  if (!user.emailVerified) throw new ApiError('VERIFY_EMAIL', 403);
  if (!user.profile) throw new ApiError('PROFILE_REQUIRED', 409);
  return {userId: user.id, profileId: user.profile.id, role: user.role, name: user.profile.name, schoolIds: user.schoolIds};
}
export const noStore = {'Cache-Control': 'private, no-store'};
