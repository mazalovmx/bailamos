import {db} from '@dance/db';
import {notify} from '../notify';
import {publicPostWhere} from './posts';
export const NEW_POST_BATCH = 500;
// A profile with more followers than this still publishes at once; the followers beyond the cap find the post in their feed.
export const NEW_POST_CAP = 10_000;
type Options = {excludeUserIds?: (string | null | undefined)[]; batch?: number; cap?: number};
/**
 * Tells the followers of a profile that it has published a post. The caller decides when: savePost reports
 * `firstPublished` exactly once per post, so a re-publication stays silent. Left out: the owner of the profile and
 * whoever published (a school manager), banned accounts, and followers with a block in either direction.
 * Followers are read in pages by id, so the work and the memory per step stay bounded. Resolves to the number notified.
 */
export async function notifyNewPost(postId: string, options: Options = {}) {
  const post = await db.post.findFirst({where: {id: postId, ...publicPostWhere, slug: {not: null}},
    select: {id: true, slug: true, title: true, profileId: true, profile: {select: {handle: true, name: true, userId: true}}}});
  if (!post?.slug) return 0;
  const skip = new Set([post.profile.userId, ...(options.excludeUserIds || [])].filter((value): value is string => !!value));
  const batch = Math.min(Math.max(options.batch ?? NEW_POST_BATCH, 1), 1000), cap = options.cap ?? NEW_POST_CAP;
  const data = {postId: post.id, slug: post.slug, handle: post.profile.handle, name: post.profile.name, title: post.title};
  const url = '/people/' + post.profile.handle + '/posts/' + post.slug;
  let cursor: string | undefined, sent = 0;
  while (sent < cap) {
    const rows: {id: string; userId: string}[] = await db.follow.findMany({
      where: {profileId: post.profileId, user: {bannedAt: null, NOT: {profile: {OR: [
        {blocksMade: {some: {blockedProfileId: post.profileId}}}, {blocksReceived: {some: {blockerProfileId: post.profileId}}}]}}}},
      orderBy: {id: 'asc'}, take: batch, ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}), select: {id: true, userId: true}});
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    const userIds = rows.map(row => row.userId).filter(userId => !skip.has(userId)).slice(0, cap - sent);
    await notify(userIds, 'NEW_POST', data, url);
    sent += userIds.length;
    if (rows.length < batch) break;
  }
  return sent;
}
