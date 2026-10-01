import {db} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {notify} from '../notify';
const id = z.string().min(1).max(64);
// Exactly one target per request, mirroring the Follow model (one target per row).
export const followTarget = z.union([z.strictObject({cityId: id}), z.strictObject({styleId: id}), z.strictObject({profileId: id})]);
export type FollowTarget = z.infer<typeof followTarget>;
type Follower = {id: string; name: string; profile?: {handle: string; name: string} | null};
export async function isFollowing(userId: string | undefined, target: FollowTarget): Promise<boolean> {
  return userId ? !!(await db.follow.findFirst({where: {userId, ...target}, select: {id: true}})) : false;
}
export async function follow(user: Follower, target: FollowTarget) {
  if ('cityId' in target) {
    if (!(await db.city.findUnique({where: {id: target.cityId}, select: {id: true}}))) throw new ApiError('TARGET_NOT_FOUND', 404);
    await db.follow.upsert({where: {userId_cityId: {userId: user.id, cityId: target.cityId}}, create: {userId: user.id, cityId: target.cityId}, update: {}});
  } else if ('styleId' in target) {
    if (!(await db.danceStyle.findUnique({where: {id: target.styleId}, select: {id: true}}))) throw new ApiError('TARGET_NOT_FOUND', 404);
    await db.follow.upsert({where: {userId_styleId: {userId: user.id, styleId: target.styleId}}, create: {userId: user.id, styleId: target.styleId}, update: {}});
  } else {
    const profile = await db.profile.findUnique({where: {id: target.profileId}, select: {id: true, userId: true, handle: true, hiddenAt: true}});
    if (!profile || profile.hiddenAt) throw new ApiError('TARGET_NOT_FOUND', 404);
    if (profile.userId === user.id) throw new ApiError('CANNOT_FOLLOW_SELF', 400);
    const where = {userId_profileId: {userId: user.id, profileId: profile.id}};
    const existed = await db.follow.findUnique({where, select: {id: true}});
    await db.follow.upsert({where, create: {userId: user.id, profileId: profile.id}, update: {}});
    // Notify once per new subscription; repeating the request stays silent.
    if (!existed && profile.userId) await notify([profile.userId], 'NEW_FOLLOWER',
      {followerName: user.profile?.name || user.name, followerHandle: user.profile?.handle || null, profileId: profile.id, profileHandle: profile.handle},
      user.profile ? '/people/' + user.profile.handle : undefined);
  }
  return {following: true};
}
export async function unfollow(userId: string, target: FollowTarget) {
  await db.follow.deleteMany({where: {userId, ...target}});
  return {following: false};
}
export async function followsOf(userId: string) {
  const rows = await db.follow.findMany({where: {userId}, orderBy: {createdAt: 'desc'}, select: {createdAt: true,
    city: {select: {id: true, slug: true, name: true, countryCode: true}}, style: {select: {id: true, slug: true, name: true}},
    profile: {select: {id: true, handle: true, name: true, type: true, hiddenAt: true}}}});
  return {
    cities: rows.flatMap(row => row.city ? [{...row.city, since: row.createdAt}] : []),
    styles: rows.flatMap(row => row.style ? [{...row.style, since: row.createdAt}] : []),
    profiles: rows.flatMap(row => row.profile && !row.profile.hiddenAt ? [{id: row.profile.id, handle: row.profile.handle, name: row.profile.name, type: row.profile.type, since: row.createdAt}] : [])
  };
}
