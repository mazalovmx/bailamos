import {db} from '@dance/db';
import {eventAbility} from '../permissions';
import {MediaError} from './errors';
import type {UploadTarget} from './keys';
export type MediaUser = {id: string; role: string; profile: {id: string} | null};
export type Parent = {eventId?: string; postId?: string};
export const isStaff = (user: {role: string}) => user.role === 'OWNER' || user.role === 'ADMIN' || user.role === 'MODERATOR';
export function profileOf(user: MediaUser) {
  if (!user.profile) throw new MediaError('PROFILE_REQUIRED', 400);
  return user.profile.id;
}
/** Event media is managed by its OWNER and CO_ORGANIZERs. */
export async function canManageEvent(profileId: string | undefined, eventId: string) {
  const event = await db.event.findUnique({where: {id: eventId}, select: {members: {select: {profileId: true, role: true}}}});
  if (!event) throw new MediaError('NOT_FOUND', 404);
  return eventAbility(profileId, event.members).can('manage', 'Event');
}
export async function ownsPost(profileId: string | undefined, postId: string) {
  const post = await db.post.findUnique({where: {id: postId}, select: {profileId: true}});
  if (!post) throw new MediaError('NOT_FOUND', 404);
  return !!profileId && post.profileId === profileId;
}
/** Checks that the user may attach media to the target and returns the parent the MediaItem will belong to. */
export async function authorizeTarget(user: MediaUser, target: UploadTarget, targetId?: string): Promise<Parent> {
  const profileId = profileOf(user);
  if (target === 'avatar' || target === 'cover') return {};
  if (!targetId) throw new MediaError('INVALID_INPUT', 400);
  if (!await (target === 'event' ? canManageEvent(profileId, targetId) : ownsPost(profileId, targetId))) throw new MediaError('FORBIDDEN', 403);
  return target === 'event' ? {eventId: targetId} : {postId: targetId};
}
