import {db, Prisma} from '@dance/db';
import {dispatchNotification} from '../notify';
const BATCH = 500, MAX_PER_POST = 10_000, MAX_BATCHES_PER_RUN = 20;
/**
 * Drains one bounded page at a time. The row lock, notification inserts and cursor advance share a transaction, so a
 * worker crash cannot advance past an unsaved page and a retry cannot duplicate an in-app notification.
 */
export async function drainPostNotificationOutbox() {
  let batches = 0, notified = 0, completed = 0;
  for (; batches < MAX_BATCHES_PER_RUN; batches++) {
    const page = await db.$transaction(async tx => {
      const [outbox] = await tx.$queryRaw<{postId: string; excludeUserId: string | null; lastFollowId: string | null; notified: number}[]>`
        SELECT "postId", "excludeUserId", "lastFollowId", "notified"
        FROM "PostNotificationOutbox" WHERE "completedAt" IS NULL
        ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!outbox) return null;
      const post = await tx.post.findFirst({where: {id: outbox.postId, publishedAt: {not: null}, hiddenAt: null,
        profile: {hiddenAt: null}}, select: {id: true, slug: true, title: true, profileId: true,
        profile: {select: {handle: true, name: true, userId: true}}}});
      const now = new Date();
      if (!post?.slug || outbox.notified >= MAX_PER_POST) {
        await tx.postNotificationOutbox.update({where: {postId: outbox.postId}, data: {completedAt: now}});
        return {users: [] as string[], data: null, url: undefined, done: true};
      }
      const exclude = [post.profile.userId, outbox.excludeUserId].filter((id): id is string => !!id);
      const rows = await tx.follow.findMany({where: {profileId: post.profileId, ...(outbox.lastFollowId ? {id: {gt: outbox.lastFollowId}} : {}),
        user: {bannedAt: null, ...(exclude.length ? {id: {notIn: exclude}} : {}), NOT: {profile: {OR: [
          {blocksMade: {some: {blockedProfileId: post.profileId}}},
          {blocksReceived: {some: {blockerProfileId: post.profileId}}}
        ]}}}}, orderBy: {id: 'asc'}, take: BATCH, select: {id: true, userId: true}});
      if (!rows.length) {
        await tx.postNotificationOutbox.update({where: {postId: outbox.postId}, data: {completedAt: now}});
        return {users: [] as string[], data: null, url: undefined, done: true};
      }
      const remaining = MAX_PER_POST - outbox.notified;
      const selected = rows.slice(0, remaining), users = selected.map(row => row.userId);
      const data = {postId: post.id, slug: post.slug, handle: post.profile.handle, name: post.profile.name, title: post.title};
      await tx.notification.createMany({data: users.map(userId => ({userId, type: 'NEW_POST', data,
        url: '/people/' + post.profile.handle + '/posts/' + post.slug,
        dedupeKey: 'post:' + post.id + ':' + userId})), skipDuplicates: true});
      const done = selected.length < rows.length || outbox.notified + users.length >= MAX_PER_POST || rows.length < BATCH;
      await tx.postNotificationOutbox.update({where: {postId: outbox.postId}, data: {
        lastFollowId: selected[selected.length - 1].id, notified: {increment: users.length}, ...(done ? {completedAt: now} : {})
      }});
      return {users, data: data as Prisma.InputJsonObject, url: '/people/' + post.profile.handle + '/posts/' + post.slug, done};
    });
    if (!page) break;
    if (page.done) completed++;
    if (page.users.length && page.data) {
      await dispatchNotification(page.users, 'NEW_POST', page.data, page.url);
      notified += page.users.length;
    }
  }
  return {batches, notified, completed};
}
