import {db} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {notify} from '../notify';
import {coarsen} from '../geo/coarsen';
import type {Searcher} from './search';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/);
export const interestInput = z.object({profileId: id, styleId: id.nullish()}).strict();
export const profileInput = z.object({profileId: id}).strict();
// `null` clears the stored position. The district is the free-text label shown next to the city.
export const locationInput = z.union([z.null(), z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  district: z.string().trim().max(80).nullish()
}).strict()]);
export function dailyInterestLimit() {
  const value = Number(process.env.MATCHING_DAILY_INTEREST_LIMIT);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : 30;
}
export const limits = {
  search: {limit: 60, windowSec: 60},
  mutate: {limit: 120, windowSec: 3600},
  // Moving the stored position is rare for a person and essential for anyone trying to locate somebody by band changes.
  location: {limit: 6, windowSec: 86400}
} as const;
const visibleProfile = {hiddenAt: null, user: {is: {bannedAt: null}}} as const;
const blockBetween = (a: string, b: string) => ({OR: [{blockerProfileId: a, blockedProfileId: b}, {blockerProfileId: b, blockedProfileId: a}]});
const notFound = () => new ApiError('NOT_FOUND', 404);
/**
 * Interest can only be expressed in somebody partner search would show: visible, owned, not banned, opted in through at least
 * one lookingFor skill, and not in a block relation. Every other case answers NOT_FOUND, so a block cannot be detected.
 */
async function target(me: string, profileId: string) {
  const profile = await db.profile.findFirst({where: {id: profileId, ...visibleProfile, skills: {some: {lookingFor: true}}},
    select: {id: true, userId: true, handle: true, name: true, skills: {where: {lookingFor: true}, select: {styleId: true}}}});
  if (!profile?.userId || await db.block.findFirst({where: blockBetween(me, profileId), select: {blockerProfileId: true}})) return null;
  return profile;
}
type Party = {userId: string; profileId: string; handle: string; name: string};
// Each side is told about the other exactly once, even if the interest is withdrawn and sent again later.
async function notifyMatch(a: Party, b: Party, styleId: string | null) {
  for (const [to, about] of [[a, b], [b, a]] as const) {
    const told = await db.notification.findFirst({where: {userId: to.userId, type: 'PARTNER_MATCH', data: {path: ['profileId'], equals: about.profileId}}, select: {id: true}});
    if (!told) await notify([to.userId], 'PARTNER_MATCH', {profileId: about.profileId, handle: about.handle, name: about.name, styleId}, '/partners/matches');
  }
}
/**
 * Records one-directional interest. The other person learns nothing until they express interest too; then both are notified.
 * Idempotent: repeating the call neither counts against the daily cap nor notifies again.
 */
export async function expressInterest(me: Searcher, input: z.infer<typeof interestInput>) {
  if (input.profileId === me.profileId) throw new ApiError('INVALID_INPUT', 400);
  const other = await target(me.profileId, input.profileId);
  if (!other) throw notFound();
  const styleId = input.styleId ?? null;
  if (styleId && !other.skills.some(skill => skill.styleId === styleId)) throw new ApiError('INVALID_INPUT', 400);
  const pair = [me.profileId, other.id].sort().join(':');
  const result = await db.$transaction(async tx => {
    // Serialises the two directions of one pair, so simultaneous mutual clicks produce exactly one match.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pair}::text, 0))`;
    const where = {fromProfileId_toProfileId: {fromProfileId: me.profileId, toProfileId: other.id}};
    const reverse = () => tx.partnerInterest.findUnique({where: {fromProfileId_toProfileId: {fromProfileId: other.id, toProfileId: me.profileId}}, select: {styleId: true}});
    if (await tx.partnerInterest.findUnique({where, select: {toProfileId: true}})) return {created: false, reverse: await reverse()};
    const today = await tx.partnerInterest.count({where: {fromProfileId: me.profileId, createdAt: {gt: new Date(Date.now() - 86400000)}}});
    if (today >= dailyInterestLimit()) throw new ApiError('DAILY_LIMIT', 429);
    await tx.partnerInterest.create({data: {fromProfileId: me.profileId, toProfileId: other.id, styleId}});
    return {created: true, reverse: await reverse()};
  });
  const matched = !!result.reverse;
  if (result.created && matched) await notifyMatch({userId: me.userId, profileId: me.profileId, handle: me.handle, name: me.name},
    {userId: other.userId!, profileId: other.id, handle: other.handle, name: other.name}, styleId ?? result.reverse!.styleId);
  return {interested: true, matched};
}
export async function withdrawInterest(profileId: string, otherProfileId: string) {
  await db.partnerInterest.deleteMany({where: {fromProfileId: profileId, toProfileId: otherProfileId}});
  return {interested: false, matched: false};
}
/** Blocking is silent and total: both stop seeing each other in partner search and every interest between them is removed. */
export async function blockProfile(profileId: string, otherProfileId: string) {
  if (profileId === otherProfileId) throw new ApiError('INVALID_INPUT', 400);
  if (!await db.profile.findUnique({where: {id: otherProfileId}, select: {id: true}})) throw notFound();
  await db.$transaction([
    db.block.createMany({data: [{blockerProfileId: profileId, blockedProfileId: otherProfileId}], skipDuplicates: true}),
    db.partnerInterest.deleteMany({where: {OR: [{fromProfileId: profileId, toProfileId: otherProfileId}, {fromProfileId: otherProfileId, toProfileId: profileId}]}})
  ]);
  return {blocked: true};
}
export async function unblockProfile(profileId: string, otherProfileId: string) {
  await db.block.deleteMany({where: {blockerProfileId: profileId, blockedProfileId: otherProfileId}});
  return {blocked: false};
}
export type Contact = {profileId: string; handle: string; name: string; avatarKey: string | null; city: string | null; district: string | null; style: string | null; since: string};
/**
 * The caller's own interests, split into mutual matches and still one-sided ones. Interest received but not returned is
 * deliberately absent: nobody can find out who is interested in them without being interested first.
 */
export async function myInterests(profileId: string): Promise<{matches: Contact[]; sent: Contact[]}> {
  const [rows, received, blocks] = await Promise.all([
    db.partnerInterest.findMany({where: {fromProfileId: profileId, to: visibleProfile}, orderBy: [{createdAt: 'desc'}, {toProfileId: 'asc'}], take: 500,
      select: {createdAt: true, style: {select: {name: true}},
        to: {select: {id: true, handle: true, name: true, avatarKey: true, district: true, city: {select: {name: true}}}}}}),
    db.partnerInterest.findMany({where: {toProfileId: profileId}, select: {fromProfileId: true}}),
    db.block.findMany({where: {OR: [{blockerProfileId: profileId}, {blockedProfileId: profileId}]}, select: {blockerProfileId: true, blockedProfileId: true}})
  ]);
  const mutual = new Set(received.map(row => row.fromProfileId));
  const blocked = new Set(blocks.flatMap(row => [row.blockerProfileId, row.blockedProfileId]));
  const matches: Contact[] = [], sent: Contact[] = [];
  for (const row of rows) {
    if (blocked.has(row.to.id)) continue;
    (mutual.has(row.to.id) ? matches : sent).push({profileId: row.to.id, handle: row.to.handle, name: row.to.name, avatarKey: row.to.avatarKey,
      city: row.to.city?.name ?? null, district: row.to.district?.trim() || null, style: row.style?.name ?? null, since: row.createdAt.toISOString()});
  }
  return {matches, sent};
}
/**
 * Stores the profile position snapped to the ~1.7 km privacy grid; the exact point is never written anywhere.
 * `geo` follows lat/lng through the profile_geo_sync trigger.
 */
export async function setLocation(profileId: string, input: z.infer<typeof locationInput>) {
  if (input === null) {
    await db.profile.update({where: {id: profileId}, data: {lat: null, lng: null}});
    return {located: false};
  }
  const point = coarsen(input.lat, input.lng);
  await db.profile.update({where: {id: profileId}, data: {...point, ...(input.district === undefined ? {} : {district: input.district || null})}});
  return {located: true};
}
/** Marks the profile as active now, writing at most once per hour. Safe to call on every authenticated request. */
export async function touchActivity(profileId: string, now = new Date()) {
  const changed = await db.$executeRaw`UPDATE "Profile" SET "lastActiveAt" = ${now}::timestamptz
    WHERE id = ${profileId} AND ("lastActiveAt" IS NULL OR "lastActiveAt" < ${now}::timestamptz - interval '1 hour')`;
  return changed > 0;
}
