import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {rateLimit} from '../rate-limit';
import {allCities} from '../catalogue/data';
import {cityLocales, cityName} from '../catalogue/city-name';
import {mediaUrl} from '../account/media';
import {searchTypes, type SearchType} from './search-types';
import {cleanQuery, highlight, isAdvanced, prefixTsQuery, searchable, snippet, type Segment} from './text';
// Site search on PostgreSQL: full-text (GIN over to_tsvector('simple', …)) combined with pg_trgm word similarity.
// The tsvector expressions below repeat the index definitions of migration 202610010008_gaps character for character
// (apart from the table alias); otherwise the planner cannot use event_search_idx, profile_search_idx and post_search_idx.
// Everything user-supplied is a bound parameter.
export {searchTypes, type SearchType};
export const PAGE_SIZE = 20, PREVIEW_SIZE = 5, MAX_OFFSET = 1000;
// `<%` matches from this word similarity on; the pg_trgm default (0.6) misses one-letter typos in short words.
export const SIMILARITY = 0.45;
const eventVector = Prisma.sql`to_tsvector('simple', coalesce(e.title, '') || ' ' || coalesce(e.description, ''))`;
const profileVector = Prisma.sql`to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.handle, '') || ' ' || coalesce(p.bio, ''))`;
const postVector = Prisma.sql`to_tsvector('simple', coalesce(p.title, '') || ' ' || coalesce(p.excerpt, ''))`;
// No index covers venue addresses yet (only venue_name_trgm_idx on the name), so this one is evaluated per row.
const venueVector = Prisma.sql`to_tsvector('simple', coalesce(v.name, '') || ' ' || coalesce(v.address, ''))`;
export type SqlInput = {q: string; cityId?: string | null; viewerProfileId?: string | null; limit: number; offset: number; now?: Date};
// websearch_to_tsquery understands quotes, OR and -exclusions; for plain queries it is widened with a prefix query in every
// accent variant, which gives search-as-you-type and accent-insensitivity while staying on the GIN index.
function matcher(q: string) {
  const advanced = isAdvanced(q), prefix = advanced ? '' : prefixTsQuery(q);
  return {q, fuzzy: !advanced && [...q].length >= 3, ts: prefix ? Prisma.sql`(websearch_to_tsquery('simple', ${q}) || to_tsquery('simple', ${prefix}))`
    : Prisma.sql`websearch_to_tsquery('simple', ${q})`};
}
type Mode = 'both' | 'text' | 'fuzzy';
// Candidates: a full-text match or a name/title within typo distance. Score: full-text hits first (1 + ts_rank),
// plus the similarity of the query to the name/title, plus one for an exact name/title.
function ranking(vector: Prisma.Sql, column: Prisma.Sql, q: string, mode: Mode = 'both') {
  const m = matcher(q), text = Prisma.sql`${vector} @@ ${m.ts}`, fuzzy = Prisma.sql`${q}::text <% ${column}`;
  return {
    match: mode === 'fuzzy' ? fuzzy : mode === 'both' && m.fuzzy ? Prisma.sql`(${text} OR ${fuzzy})` : text,
    score: Prisma.sql`(CASE WHEN ${text} THEN 1 + ts_rank(${vector}, ${m.ts}) ELSE 0 END + word_similarity(${q}::text, ${column})
      + CASE WHEN lower(${column}) = lower(${q}::text) THEN 1 ELSE 0 END)::float8`
  };
}
const notBlocked = (viewer: string | null | undefined, profile: Prisma.Sql) => viewer ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "Block" b
  WHERE (b."blockerProfileId" = ${viewer} AND b."blockedProfileId" = ${profile}) OR (b."blockerProfileId" = ${profile} AND b."blockedProfileId" = ${viewer}))` : Prisma.empty;
const page = ({limit, offset}: SqlInput) => Prisma.sql`LIMIT ${limit}::int OFFSET ${offset}::int`;
type Base = {id: string; body: string | null; score: number; total: bigint};
type Located = {cityName: string | null; cityNames: unknown};
export type EventRow = Base & Located & {slug: string; title: string; timezone: string; when: Date; upcoming: boolean; venue: string | null};
export type ProfileRow = Base & Located & {handle: string; name: string; profileType: string; avatarKey: string | null};
export type PostRow = Base & Located & {slug: string; title: string; publishedAt: Date; authorHandle: string; authorName: string};
export type VenueRow = Base & Located & {name: string};
// Published, visible events. Those with a date still ahead come first, then by relevance, then by closeness to today.
export function eventsSql(input: SqlInput): Prisma.Sql {
  const {match, score} = ranking(eventVector, Prisma.sql`e.title`, input.q), now = input.now || new Date();
  return Prisma.sql`
    SELECT e.id, e.slug, e.title, left(e.description, 6000) AS body, e.timezone, w."when", w."when" >= ${now}::timestamptz AS upcoming,
      c.name AS "cityName", c.names AS "cityNames", v.name AS venue, ${score} AS score, count(*) OVER() AS total
    FROM "Event" e JOIN "City" c ON c.id = e."cityId" LEFT JOIN "Venue" v ON v.id = e."venueId" AND v."hiddenAt" IS NULL
      CROSS JOIN LATERAL (SELECT COALESCE((SELECT min(o."startsAt") FROM "EventOccurrence" o
        WHERE o."eventId" = e.id AND NOT o.cancelled AND o."startsAt" >= ${now}::timestamptz), e."startsAt") AS "when") w
    WHERE e.status = 'PUBLISHED' AND e."hiddenAt" IS NULL AND ${match}
      ${input.cityId ? Prisma.sql`AND e."cityId" = ${input.cityId}` : Prisma.empty}
    ORDER BY upcoming DESC, score DESC, abs(extract(epoch FROM w."when" - ${now}::timestamptz)), e.id ${page(input)}`;
}
// Profiles that are not hidden, not banned and not in a block relation with the viewer. Coordinates and emails are never selected.
export function profilesSql(input: SqlInput, schools: boolean): Prisma.Sql {
  const {match, score} = ranking(profileVector, Prisma.sql`p.name`, input.q), handle = input.q.replace(/^@/, '');
  return Prisma.sql`
    SELECT p.id, p.handle, p.name, p.type::text AS "profileType", left(p.bio, 6000) AS body, p."avatarKey", c.name AS "cityName", c.names AS "cityNames",
      (${score} + CASE WHEN lower(p.handle) = lower(${handle}::text) THEN 1 ELSE 0 END)::float8 AS score, count(*) OVER() AS total
    FROM "Profile" p LEFT JOIN "City" c ON c.id = p."cityId" LEFT JOIN "User" u ON u.id = p."userId"
    WHERE p."hiddenAt" IS NULL AND u."bannedAt" IS NULL AND ${schools ? Prisma.sql`p.type = 'SCHOOL'` : Prisma.sql`p.type <> 'SCHOOL'`} AND ${match}
      ${notBlocked(input.viewerProfileId, Prisma.sql`p.id`)}
      ${input.cityId ? Prisma.sql`AND p."cityId" = ${input.cityId}` : Prisma.empty}
    ORDER BY score DESC, p.name, p.id ${page(input)}`;
}
// Published, visible posts of visible authors. `mode: 'fuzzy'` is the typo fallback: there is no trigram index on Post.title,
// so it scans the table and runs only when the indexed full-text query found nothing.
export function postsSql(input: SqlInput, mode: Mode = 'text'): Prisma.Sql {
  const {match, score} = ranking(postVector, Prisma.sql`p.title`, input.q, mode);
  return Prisma.sql`
    SELECT p.id, p.slug, p.title, p.excerpt AS body, p."publishedAt", a.handle AS "authorHandle", a.name AS "authorName",
      c.name AS "cityName", c.names AS "cityNames", ${score} AS score, count(*) OVER() AS total
    FROM "Post" p JOIN "Profile" a ON a.id = p."profileId" LEFT JOIN "User" u ON u.id = a."userId"
      LEFT JOIN "Event" pe ON pe.id = p."eventId" LEFT JOIN "City" c ON c.id = COALESCE(pe."cityId", a."cityId")
    WHERE p."publishedAt" IS NOT NULL AND p."hiddenAt" IS NULL AND p.slug IS NOT NULL AND a."hiddenAt" IS NULL AND u."bannedAt" IS NULL AND ${match}
      ${notBlocked(input.viewerProfileId, Prisma.sql`a.id`)}
      ${input.cityId ? Prisma.sql`AND (pe."cityId" = ${input.cityId} OR a."cityId" = ${input.cityId})` : Prisma.empty}
    ORDER BY score DESC, p."publishedAt" DESC, p.id ${page(input)}`;
}
// Visible venues by name (typo-tolerant, indexed) or by a word of the address. Coordinates are not selected.
export function venuesSql(input: SqlInput): Prisma.Sql {
  const {match, score} = ranking(venueVector, Prisma.sql`v.name`, input.q);
  return Prisma.sql`
    SELECT v.id, v.name, v.address AS body, c.name AS "cityName", c.names AS "cityNames", ${score} AS score, count(*) OVER() AS total
    FROM "Venue" v JOIN "City" c ON c.id = v."cityId"
    WHERE v."hiddenAt" IS NULL AND ${match}
      ${input.cityId ? Prisma.sql`AND v."cityId" = ${input.cityId}` : Prisma.empty}
    ORDER BY score DESC, v.name, v.id ${page(input)}`;
}
// The similarity threshold is a session setting; `true` keeps it local to the surrounding transaction.
export const similaritySql = () => Prisma.sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(SIMILARITY)}, true)`;
export type Hit = {
  type: SearchType; id: string; path: string; title: Segment[]; snippet: Segment[] | null; city: string | null;
  startsAt?: string; timezone?: string; upcoming?: boolean; venue?: string | null;
  handle?: string; profileType?: string; avatar?: string | null; author?: string; publishedAt?: string;
};
export type SearchResult = {
  q: string; type: SearchType | 'all'; city: {id: string; slug: string; name: string} | null;
  counts: Record<SearchType, number>; total: number; groups: Record<SearchType, Hit[]>; nextCursor: string | null;
};
export const searchInput = z.object({
  q: z.string().max(400), type: z.enum([...searchTypes, 'all']).default('all'), city: z.string().max(64).optional(),
  cursor: z.string().regex(/^\d{1,4}$/).optional(), limit: z.coerce.number().int().min(1).max(PAGE_SIZE).optional(), locale: z.enum(cityLocales).default('en')
});
export type SearchInput = z.infer<typeof searchInput>;
// Reads ?q=&type=&city=&cursor=&limit=&locale= from a query string; empty values count as absent.
export function parseSearch(params: URLSearchParams): SearchInput {
  const raw: Record<string, string> = {q: params.get('q') || ''};
  for (const key of ['type', 'city', 'cursor', 'limit', 'locale']) {const value = params.get(key); if (value) raw[key] = value;}
  return searchInput.parse(raw);
}
// One hit per `limit` window: 90 searches a minute cover search-as-you-type and stop scraping; counted per address and per account.
export async function searchRateLimit(ip: string, userId?: string | null) {
  const results = await Promise.all([rateLimit('search:ip:' + ip, {limit: 90, windowSec: 60}), ...(userId ? [rateLimit('search:user:' + userId, {limit: 90, windowSec: 60})] : [])]);
  return results.find(result => !result.ok) || results[0];
}
const total = (rows: readonly Base[]) => rows.length ? Number(rows[0].total) : 0;
/**
 * Public search. `type: 'all'` returns the first few hits of every type; a single type returns one page of it.
 * Counts of all types always come back, so the tabs can show them. Throws QUERY_TOO_SHORT / CITY_NOT_FOUND (400).
 */
export async function search(input: SearchInput, viewerProfileId?: string | null, now = new Date()): Promise<SearchResult> {
  const q = cleanQuery(input.q), {type, locale} = input;
  if (!searchable(q)) throw new ApiError('QUERY_TOO_SHORT', 400);
  const city = input.city ? (await allCities()).find(item => item.id === input.city || item.slug === input.city) : null;
  if (input.city && !city) throw new ApiError('CITY_NOT_FOUND', 400);
  const offset = type === 'all' ? 0 : Math.min(Number(input.cursor || 0), MAX_OFFSET), size = input.limit || (type === 'all' ? PREVIEW_SIZE : PAGE_SIZE);
  // Types that are not on screen still run with LIMIT 1 for their count.
  const sql = (wanted: SearchType): SqlInput => ({q, cityId: city?.id, viewerProfileId, now, limit: type === 'all' || type === wanted ? size : 1, offset: type === wanted ? offset : 0});
  const [, events, people, schools, found, venues] = await db.$transaction([db.$queryRaw(similaritySql()),
    db.$queryRaw<EventRow[]>(eventsSql(sql('events'))), db.$queryRaw<ProfileRow[]>(profilesSql(sql('people'), false)), db.$queryRaw<ProfileRow[]>(profilesSql(sql('schools'), true)),
    db.$queryRaw<PostRow[]>(postsSql(sql('posts'))), db.$queryRaw<VenueRow[]>(venuesSql(sql('venues')))]);
  let posts = found;
  if (!posts.length && !offset && !isAdvanced(q) && [...q].length >= 3)
    posts = (await db.$transaction([db.$queryRaw(similaritySql()), db.$queryRaw<PostRow[]>(postsSql(sql('posts'), 'fuzzy'))]))[1];
  const place = (row: Located) => row.cityName ? cityName({name: row.cityName, names: row.cityNames}, locale) : null;
  const shown = <T>(wanted: SearchType, rows: T[]) => type === 'all' || type === wanted ? rows : [];
  const profile = (kind: 'people' | 'schools') => (row: ProfileRow): Hit => ({type: kind, id: row.id, path: '/' + kind + '/' + row.handle, title: highlight(row.name, q),
    snippet: snippet(row.body, q), city: place(row), handle: row.handle, profileType: row.profileType, avatar: row.avatarKey ? mediaUrl(row.avatarKey) : null});
  const groups: Record<SearchType, Hit[]> = {
    events: shown('events', events).map(row => ({type: 'events', id: row.id, path: '/events/' + row.slug, title: highlight(row.title, q), snippet: snippet(row.body, q),
      city: place(row), startsAt: row.when.toISOString(), timezone: row.timezone, upcoming: row.upcoming, venue: row.venue})),
    people: shown('people', people).map(profile('people')), schools: shown('schools', schools).map(profile('schools')),
    posts: shown('posts', posts).map(row => ({type: 'posts', id: row.id, path: '/people/' + row.authorHandle + '/posts/' + row.slug, title: highlight(row.title, q),
      snippet: snippet(row.body, q), city: place(row), author: row.authorName, handle: row.authorHandle, publishedAt: row.publishedAt.toISOString()})),
    venues: shown('venues', venues).map(row => ({type: 'venues', id: row.id, path: '/venues/' + row.id, title: highlight(row.name, q), snippet: snippet(row.body, q), city: place(row)}))
  };
  const counts = {events: total(events), people: total(people), schools: total(schools), posts: total(posts), venues: total(venues)};
  const next = type !== 'all' && offset + groups[type].length < counts[type] && offset + size <= MAX_OFFSET ? String(offset + size) : null;
  return {q, type, city: city ? {id: city.id, slug: city.slug, name: cityName(city, locale)} : null, counts,
    total: searchTypes.reduce((sum, key) => sum + counts[key], 0), groups, nextCursor: next};
}
