import {db} from '@dance/db';
import {eventAbility} from '../permissions';
import {MediaError} from './errors';
import type {UploadTarget} from './keys';
export type MediaUser = {id: string; role: string; profile: {id: string} | null; schoolIds?: string[]};
export type Parent = {eventId?: string; postId?: string};
export const isStaff = (user: {role: string}) => user.role === 'OWNER' || user.role === 'ADMIN' || user.role === 'MODERATOR';
export function profileOf(user: MediaUser) {
  if (!user.profile) throw new MediaError('PROFILE_REQUIRED', 400);
  return user.profile.id;
}
/** Event media is managed by its OWNER and CO_ORGANIZERs, and by whoever manages the school the event belongs to. */
export async function canManageEvent(profileId: string | undefined, eventId: string, schoolIds: string[] = []) {
  const event = await db.event.findUnique({where: {id: eventId}, select: {schoolProfileId: true, members: {select: {profileId: true, role: true}}}});
  if (!event) throw new MediaError('NOT_FOUND', 404);
  return eventAbility(profileId, event.members, !!event.schoolProfileId && schoolIds.includes(event.schoolProfileId)).can('manage', 'Event');
}
export async function ownsPost(profileId: string | undefined, postId: string, schoolIds: string[] = []) {
  const post = await db.post.findUnique({where: {id: postId}, select: {profileId: true}});
  if (!post) throw new MediaError('NOT_FOUND', 404);
  return (!!profileId && post.profileId === profileId) || schoolIds.includes(post.profileId);
}
/** Checks that the user may attach media to the target and returns the parent the MediaItem will belong to. */
export async function authorizeTarget(user: MediaUser, target: UploadTarget, targetId?: string): Promise<Parent> {
  const profileId = profileOf(user);
  // The map photo of an event is uploaded while the event is being written; the form then hands its key to the event.
  if (target === 'avatar' || target === 'cover' || target === 'eventmap') return {};
  if (!targetId) throw new MediaError('INVALID_INPUT', 400);
  if (target === 'chat') {
    // The chat's own gate decides: an accepted member who may write, and never inside a request that is still pending.
    // Loaded on demand so the media libraries stay usable without the chat module.
    const {attachmentAccess} = await import('../chat/service');
    await attachmentAccess({userId: user.id, profileId, role: user.role, name: '', schoolIds: user.schoolIds}, targetId);
    return {};
  }
  if (!await (target === 'event' ? canManageEvent(profileId, targetId, user.schoolIds) : ownsPost(profileId, targetId, user.schoolIds))) throw new MediaError('FORBIDDEN', 403);
  return target === 'event' ? {eventId: targetId} : {postId: targetId};
}
