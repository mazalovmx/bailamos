import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {distanceBand, LEVELS, levelIndex, rank, roleFit, score, type Band} from './score';
// Partner search. Consent is absolute: a profile is reachable here only through a DanceSkill whose owner set lookingFor = true,
// and only by somebody who is searchable too. Coordinates and distances are used inside SQL and scoring and never returned.
export type SearcherSkill = {styleId: string; style: string; role: string; level: string};
export type Searcher = {
  userId: string; profileId: string; handle: string; name: string; cityId: string | null; hasCoordinates: boolean;
  skills: SearcherSkill[]; // only the skills with lookingFor = true
  styleIds: string[]; // every style on the profile, used for the "shared styles" bonus
};
export type Ineligible = 'UNAUTHORIZED' | 'VERIFY_EMAIL' | 'BANNED' | 'PROFILE_REQUIRED' | 'PROFILE_HIDDEN' | 'LOOKING_FOR_REQUIRED';
const STATUS: Record<Ineligible, number> = {UNAUTHORIZED: 401, VERIFY_EMAIL: 403, BANNED: 403, PROFILE_REQUIRED: 403, PROFILE_HIDDEN: 403, LOOKING_FOR_REQUIRED: 403};
type UserLike = {id: string; emailVerified: boolean; bannedAt?: Date | null; profile: {id: string} | null} | null | undefined;
/**
 * Who may search: signed in, verified, not banned, with a visible profile and at least one own lookingFor skill (reciprocity).
 * Everything is re-read from the database, so a stale session object cannot widen access.
 */
export async function loadSearcher(user: UserLike): Promise<{searcher: Searcher} | {reason: Ineligible}> {
  if (!user) return {reason: 'UNAUTHORIZED'};
  if (!user.emailVerified) return {reason: 'VERIFY_EMAIL'};
  if (user.bannedAt) return {reason: 'BANNED'};
  if (!user.profile) return {reason: 'PROFILE_REQUIRED'};
  const profile = await db.profile.findFirst({where: {id: user.profile.id, userId: user.id}, select: {
    id: true, handle: true, name: true, cityId: true, lat: true, hiddenAt: true, user: {select: {bannedAt: true}},
    skills: {orderBy: [{style: {name: 'asc'}}, {role: 'asc'}], select: {styleId: true, role: true, level: true, lookingFor: true, style: {select: {name: true}}}}}});
  if (!profile) return {reason: 'PROFILE_REQUIRED'};
  if (profile.user?.bannedAt) return {reason: 'BANNED'};
  if (profile.hiddenAt) return {reason: 'PROFILE_HIDDEN'};
  const skills = profile.skills.filter(skill => skill.lookingFor === true).map(skill => ({styleId: skill.styleId, style: skill.style.name, role: skill.role, level: skill.level}));
  if (!skills.length) return {reason: 'LOOKING_FOR_REQUIRED'};
  return {searcher: {userId: user.id, profileId: profile.id, handle: profile.handle, name: profile.name, cityId: profile.cityId,
    hasCoordinates: profile.lat !== null, skills, styleIds: [...new Set(profile.skills.map(skill => skill.styleId))]}};
}
export async function requireSearcher(user: UserLike): Promise<Searcher> {
  const result = await loadSearcher(user);
  if ('reason' in result) throw new ApiError(result.reason, STATUS[result.reason]);
  return result.searcher;
}
// Query-string validation. Values stay strings until they match a strict pattern; unknown keys are rejected.
export const RADII = [10, 25, 50, 100] as const;
export const PAGE_SIZE = 20;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/);
const flag = z.enum(['0', '1']).optional().transform(value => value === '1');
const integer = (min: number, max: number, fallback: number) => z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().min(min).max(max))
  .optional().transform(value => value ?? fallback);
export const candidateQuery = z.object({
  style: id.optional(), subStyles: flag, widen: flag,
  cityId: id.optional(), radiusKm: z.enum(['10', '25', '50', '100']).transform(Number).optional(),
  offset: integer(0, 2000, 0), limit: integer(1, 50, PAGE_SIZE)
}).strict().refine(value => !(value.cityId && value.radiusKm));
export type CandidateQuery = z.infer<typeof candidateQuery>;
export type CandidateSkill = {styleId: string; style: string; role: string; level: string};
/** Everything a searcher may learn about a candidate. No coordinates, no distance, no activity time, no score. */
export type Candidate = {
  profileId: string; handle: string; name: string; avatarKey: string | null; bio: string | null;
  city: string | null; district: string | null; skills: CandidateSkill[]; distanceBand: Band | null; interested: boolean;
};
export type CandidatePage = {candidates: Candidate[]; total: number; offset: number; nextOffset: number | null};
type Row = {
  id: string; handle: string; name: string; avatarKey: string | null; bio: string | null; district: string | null; city: string | null;
  lastActiveAt: Date | null; skillId: string; styleId: string; styleName: string; role: string; level: string; myRole: string;
  gap: number; distanceM: number | null; exact: boolean | null; shared: number;
};
const MAX_ROWS = 3000;
export function excerpt(text: string | null | undefined, max = 160) {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}
export async function findCandidates(me: Searcher, query: CandidateQuery, now = new Date()): Promise<CandidatePage> {
  // The style filter can only narrow the searcher's own lookingFor skills: role and level are compared against that skill.
  const mine = query.style ? me.skills.filter(skill => skill.styleId === query.style) : me.skills;
  if (!mine.length) throw new ApiError('STYLE_NOT_ALLOWED', 400);
  const cityId = query.radiusKm ? null : query.cityId ?? me.cityId;
  if (query.radiusKm ? !me.hasCoordinates && !me.cityId : !cityId) throw new ApiError('LOCATION_REQUIRED', 400);
  // A profile without coordinates of its own is placed at its city centre for the radius test.
  const place = query.radiusKm
    ? Prisma.sql`(ST_DWithin(p.geo, o.geo, ${query.radiusKm * 1000}::float8) OR (p.geo IS NULL AND ST_DWithin(c.geo, o.geo, ${query.radiusKm * 1000}::float8)))`
    : Prisma.sql`p."cityId" = ${cityId}`;
  const levelFilter = query.widen ? Prisma.empty
    : Prisma.sql`AND abs(array_position(${[...LEVELS]}::text[], k.level::text) - 1 - m.lvl) <= 1`;
  const rows = await db.$queryRaw<Row[]>`
    WITH RECURSIVE mine(style_id, role, lvl) AS (
      SELECT * FROM unnest(${mine.map(skill => skill.styleId)}::text[], ${mine.map(skill => skill.role)}::text[], ${mine.map(skill => levelIndex(skill.level))}::int[])
    ), family(root, id) AS (
      SELECT DISTINCT style_id, style_id FROM mine
      UNION SELECT f.root, s.id FROM "DanceStyle" s JOIN family f ON s."parentId" = f.id WHERE ${query.subStyles}::boolean
    ), origin AS (
      SELECT COALESCE(p.geo, c.geo) AS geo, p.geo IS NOT NULL AS exact
      FROM "Profile" p LEFT JOIN "City" c ON c.id = p."cityId" WHERE p.id = ${me.profileId}
    )
    SELECT p.id, p.handle, p.name, p."avatarKey", p.bio, p.district, p."lastActiveAt", c.name AS city,
      k.id AS "skillId", k."styleId", s.name AS "styleName", k.role::text AS role, k.level::text AS level, m.role AS "myRole",
      abs(array_position(${[...LEVELS]}::text[], k.level::text) - 1 - m.lvl)::int AS gap,
      ST_Distance(COALESCE(p.geo, c.geo), o.geo) AS "distanceM", (p.geo IS NOT NULL AND o.exact) AS exact,
      (SELECT count(DISTINCT x."styleId") FROM "DanceSkill" x WHERE x."profileId" = p.id AND x."styleId" = ANY(${me.styleIds}::text[]))::int AS shared
    FROM mine m
    JOIN family f ON f.root = m.style_id
    JOIN "DanceSkill" k ON k."styleId" = f.id AND k."lookingFor" = true
    JOIN "DanceStyle" s ON s.id = k."styleId"
    JOIN "Profile" p ON p.id = k."profileId"
    JOIN "User" u ON u.id = p."userId"
    LEFT JOIN "City" c ON c.id = p."cityId"
    CROSS JOIN origin o
    WHERE p.id <> ${me.profileId} AND p."hiddenAt" IS NULL AND u."bannedAt" IS NULL
      AND (k.role::text = 'BOTH' OR m.role = 'BOTH' OR k.role::text <> m.role)
      ${levelFilter}
      AND NOT EXISTS (SELECT 1 FROM "Block" b WHERE (b."blockerProfileId" = ${me.profileId} AND b."blockedProfileId" = p.id)
        OR (b."blockerProfileId" = p.id AND b."blockedProfileId" = ${me.profileId}))
      AND ${place}
    ORDER BY p."lastActiveAt" DESC NULLS LAST, p.id, k.id
    LIMIT ${MAX_ROWS}::int`;
  // One row per (candidate skill, own skill) pair: fold into one entry per profile and keep the best pair's score.
  const mineStyles = new Set(me.styleIds);
  type Pair = {levelGap: number; roleFit: number; band: Band | null; lastActiveAt: Date | null; sharedStyles: number};
  const found = new Map<string, {row: Row; skills: Map<string, CandidateSkill>; best: Pair | null}>();
  for (const row of rows) {
    let entry = found.get(row.id);
    if (!entry) found.set(row.id, entry = {row, skills: new Map(), best: null});
    entry.skills.set(row.skillId, {styleId: row.styleId, style: row.styleName, role: row.role, level: row.level});
    const pair: Pair = {levelGap: Number(row.gap), roleFit: roleFit(row.myRole, row.role), band: distanceBand(row.distanceM), lastActiveAt: row.lastActiveAt, sharedStyles: 0};
    if (!entry.best || score(pair, now) > score(entry.best, now)) entry.best = pair;
  }
  const ranked = rank([...found.values()].map(({row, skills, best}) => {
    // "Shared additional styles": styles both dance beyond the ones that produced this match.
    const matched = new Set([...skills.values()].map(skill => skill.styleId).filter(styleId => mineStyles.has(styleId)));
    return {id: row.id, score: score({...best!, sharedStyles: Math.max(0, Number(row.shared) - matched.size)}, now), row, skills};
  }));
  const page = ranked.slice(query.offset, query.offset + query.limit);
  const sent = page.length ? new Set((await db.partnerInterest.findMany({where: {fromProfileId: me.profileId, toProfileId: {in: page.map(item => item.id)}},
    select: {toProfileId: true}})).map(interest => interest.toProfileId)) : new Set<string>();
  const candidates = page.map(({row, skills}): Candidate => ({
    profileId: row.id, handle: row.handle, name: row.name, avatarKey: row.avatarKey, bio: excerpt(row.bio),
    city: row.city, district: row.district?.trim() || null,
    skills: [...skills.values()].sort((a, b) => a.style.localeCompare(b.style) || a.role.localeCompare(b.role)),
    // A label is shown only when both people stored a (coarsened) position; a city-centre fallback would be a made-up distance.
    distanceBand: row.exact ? distanceBand(row.distanceM) : null,
    interested: sent.has(row.id)
  }));
  const end = query.offset + page.length;
  return {candidates, total: ranked.length, offset: query.offset, nextOffset: end < ranked.length ? end : null};
}
