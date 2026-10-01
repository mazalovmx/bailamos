import {DateTime, IANAZone} from 'luxon';
import {db, Prisma, type ImportSource, type ImportStatus} from '@dance/db';
import {geocode} from '../geo/geocode';
import {withRedis} from '../redis';
import {MAX_DATES, schedule} from '../schedule';
import {ensureShortCode} from '../events/short-code';
import {createEvent, importApproved, payloadKey, readyPayload, stampItem, type Payload, type ReadyPayload} from './create';
import {dedupeKey, distanceM, fuzzyMatch, type Keyed} from './dedupe';
import {ImportFetchError, safeFetch} from './fetch';
import {parseIcal} from './parse-ical';
import {parseNews, parseRssEvents} from './parse-rss';
import {parseSchemaOrg} from './parse-schema';
import {assertRobots} from './robots';
import {sweepMissing, syncImported} from './sync';
import {STAMP} from './text';
import {MAX_ITEMS, type ParsedEvent} from './types';
// Fetch → parse → resolve (timezone, city, coordinates) → de-duplicate → Event. One source at a time; nothing in here
// throws to the caller: a broken source ends up as `ok: false` in ImportSource.lastStatus and nowhere else.
export type SourceState = {ok?: boolean; at?: string; http?: number; etag?: string | null; lastModified?: string | null;
  failures?: number; error?: string; counts?: Record<string, number>};
export function readState(value: string | null | undefined): SourceState {
  try {
    const state: unknown = JSON.parse(value || '{}');
    return state && typeof state === 'object' && !Array.isArray(state) ? state as SourceState : {};
  } catch {return {};}
}
export type RunResult = {sourceId: string; ok: boolean; skipped?: 'NOT_FOUND' | 'DISABLED' | 'LOCKED'; notModified?: boolean; error?: string; counts: Record<string, number>};
type City = {id: string; name: string; countryCode: string; timezone: string; lat: number; lng: number};
type Context = {now: Date; cities: Map<string, City>; geocodes: number};
const MAX_GEOCODES = 20, CITY_RADIUS_M = 60_000, SOURCE_CITY_RADIUS_M = 150_000, MAX_SPAN_MS = 31 * 86400_000;
const log = (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) =>
  console[level === 'info' ? 'log' : level](JSON.stringify({level, event, ...data}));
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
async function loadCities() {
  const rows = await db.city.findMany({select: {id: true, name: true, countryCode: true, timezone: true, lat: true, lng: true}});
  return new Map(rows.map(city => [city.id, city]));
}
type Resolved = {payload: Payload; reject?: string; review?: string};
// Fills in what the feed left out. Never throws: a geocoder outage only means the city stands in for the address.
// `known` is the answer of an earlier run for the same address (null: nothing was found): the geocoder is not asked again.
export async function resolveItem(source: Pick<ImportSource, 'cityId'>, item: ParsedEvent, context: Context, known?: {point: {lat: number; lng: number} | null}): Promise<Resolved> {
  const sourceCity = source.cityId ? context.cities.get(source.cityId) : undefined;
  let point = item.lat !== undefined && item.lng !== undefined ? {lat: item.lat, lng: item.lng} : known?.point ?? null;
  const query = item.address || (item.venueName && sourceCity ? item.venueName + ', ' + sourceCity.name : '');
  if (!point && !known && query && context.geocodes < MAX_GEOCODES) {
    context.geocodes++;
    const hit = await geocode(query, {countryCode: sourceCity?.countryCode}).catch(() => null);
    // A hit far from the source's own city is more likely a wrong match than a real address.
    if (hit && (!sourceCity || distanceM(hit, sourceCity) <= SOURCE_CITY_RADIUS_M)) point = {lat: hit.lat, lng: hit.lng};
  }
  let city: City | undefined;
  if (point) {
    const at = point;
    city = [...context.cities.values()].map(candidate => ({candidate, metres: distanceM(candidate, at)}))
      .filter(entry => entry.metres <= CITY_RADIUS_M).sort((a, b) => a.metres - b.metres)[0]?.candidate;
    if (!city && sourceCity && distanceM(sourceCity, at) <= SOURCE_CITY_RADIUS_M) city = sourceCity;
  } else city = sourceCity;
  const zone = item.timezone && IANAZone.isValidZone(item.timezone) ? item.timezone : city?.timezone;
  const instant = (absolute?: Date, local?: string) => {
    const date = absolute ?? (local && zone ? DateTime.fromISO(local, {zone}).toJSDate() : undefined);
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
  };
  const startsAt = instant(item.startsAt, item.startsLocal);
  let endsAt = instant(item.endsAt, item.endsLocal) ?? null;
  if (endsAt && startsAt && (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > MAX_SPAN_MS)) endsAt = null;
  let review = item.review, rrule: string | null = null;
  let dates = startsAt ? [{startsAt, endsAt}] : [];
  if (startsAt && zone && item.recurrence) {
    try {
      const from = DateTime.fromJSDate(startsAt, {zone}), to = endsAt ? DateTime.fromJSDate(endsAt, {zone}) : from.plus({hours: 1});
      const plan = schedule(from.toFormat(STAMP), to.toFormat(STAMP), zone, item.recurrence);
      rrule = plan.rrule;
      dates = plan.occurrences.map(date => ({startsAt: date.startsAt, endsAt: endsAt ? date.endsAt : null}));
    } catch {review ||= 'RRULE_UNSUPPORTED';}
  } else if (item.occurrences?.length) {
    dates = item.occurrences.filter(date => !Number.isNaN(date.startsAt.getTime()) && date.startsAt >= context.now).slice(0, MAX_DATES)
      .map(date => ({startsAt: date.startsAt, endsAt: date.endsAt && date.endsAt > date.startsAt ? date.endsAt : null}));
  }
  const first = dates[0], last = dates[dates.length - 1];
  const payload: Payload = {title: item.title, description: item.description || null,
    startsAt: (first?.startsAt ?? startsAt)?.toISOString() ?? null, endsAt: (first ? first.endsAt : endsAt)?.toISOString() ?? null,
    timezone: zone ?? null, cityId: city?.id ?? null, venueName: item.venueName || null, address: item.address || null,
    lat: point?.lat ?? null, lng: point?.lng ?? null, precise: !!point, url: item.url || null, rrule, sourceRrule: item.rrule || null,
    allDay: !!item.allDay, occurrences: dates.map(date => ({startsAt: date.startsAt.toISOString(), endsAt: date.endsAt?.toISOString() ?? null}))};
  // A weekly series is over when its last date has passed; single dates when none of them is still ahead.
  const past = !first || (rrule ? last.startsAt < context.now : !dates.some(date => date.startsAt >= context.now));
  const reject = item.cancelled ? 'CANCELLED' : !item.title ? 'NO_TITLE' : !item.startsAt && !item.startsLocal ? 'NO_DATE'
    : !city ? 'NO_CITY' : !startsAt ? 'NO_DATE' : past ? 'PAST' : undefined;
  return {payload, reject, review};
}
type Match = {kind: 'exact' | 'fuzzy'; eventId: string | null; title: string};
// Exact: the same key on an event or on another imported item. Fuzzy: an event of that city around that time which
// looks like the same thing. Events without a stored key (created before keys existed) get one computed on the fly.
export async function findMatch(payload: ReadyPayload, key: string, context: Pick<Context, 'cities'>, exclude?: {sourceId: string; externalId: string}): Promise<Match | null> {
  const [event, item] = await Promise.all([
    db.event.findFirst({where: {dedupeKey: key, status: {not: 'CANCELLED'}}, select: {id: true, title: true}}),
    db.importedItem.findFirst({where: {dedupeKey: key, status: {in: ['IMPORTED', 'REVIEW', 'PENDING']},
      ...(exclude ? {NOT: {sourceId: exclude.sourceId, externalId: exclude.externalId}} : {})}, select: {eventId: true}})]);
  if (event) return {kind: 'exact', eventId: event.id, title: event.title};
  if (item) return {kind: 'exact', eventId: item.eventId, title: payload.title};
  const startsAt = new Date(payload.startsAt), window = 36 * 3600_000;
  const mine: Keyed = {title: payload.title, startsAt, timezone: payload.timezone, cityId: payload.cityId, lat: payload.lat, lng: payload.lng, precise: payload.precise};
  const near = await db.eventOccurrence.findMany({
    where: {cancelled: false, startsAt: {gte: new Date(startsAt.getTime() - window), lte: new Date(startsAt.getTime() + window)}, event: {cityId: payload.cityId, status: {not: 'CANCELLED'}}},
    select: {startsAt: true, event: {select: {id: true, title: true, timezone: true, cityId: true, lat: true, lng: true}}}, orderBy: {startsAt: 'asc'}, take: 300});
  let fuzzy: Match | null = null;
  for (const {startsAt: date, event: other} of near) {
    const city = context.cities.get(other.cityId);
    // Events made on the site without a venue carry the coordinates of the city centre, which is not a place.
    const theirs: Keyed = {...other, startsAt: date, precise: !(city && other.lat === city.lat && other.lng === city.lng)};
    if (dedupeKey(theirs) === key) return {kind: 'exact', eventId: other.id, title: other.title};
    if (!fuzzy && fuzzyMatch(mine, theirs)) fuzzy = {kind: 'fuzzy', eventId: other.id, title: other.title};
  }
  return fuzzy;
}
const where = (sourceId: string, externalId: string) => ({sourceId_externalId: {sourceId, externalId}});
// Decides the fate of one parsed item. Items already decided (duplicate, rejected, waiting for review) are left alone;
// an imported one keeps following its source (sync.ts).
export async function processItem(source: Pick<ImportSource, 'id' | 'url' | 'cityId'>, item: ParsedEvent, context: Context): Promise<ImportStatus | 'SKIPPED' | 'UPDATED' | 'CANCELLED'> {
  if (!item.externalId) return 'SKIPPED';
  const existing = await db.importedItem.findUnique({where: where(source.id, item.externalId)});
  if (existing?.status === 'IMPORTED') return syncImported(source, existing, item, known => resolveItem(source, item, context, known), context.now);
  if (existing && existing.status !== 'PENDING') return 'SKIPPED';
  // Confirmed in the admin panel: PENDING with note APPROVED means "create it, do not compare again".
  if (existing?.note === 'APPROVED') return (await importApproved({...existing, source}, null, context.now)).status;
  const {payload, reject, review} = await resolveItem(source, item, context);
  const ready = reject ? null : readyPayload.safeParse(payload);
  const key = ready?.success ? payloadKey(ready.data) : null;
  const save = (status: ImportStatus, note: string | null, eventId: string | null = null) => {
    const data = {status, note: note?.slice(0, 300) ?? null, eventId, payload: json(payload), dedupeKey: key};
    return db.importedItem.upsert({where: where(source.id, item.externalId), create: {sourceId: source.id, externalId: item.externalId, ...data}, update: data});
  };
  if (!ready?.success || !key) {await save('REJECTED', reject || 'INVALID'); return 'REJECTED';}
  const match = await findMatch(ready.data, key, context, {sourceId: source.id, externalId: item.externalId});
  if (match?.kind === 'exact') {await save('DUPLICATE', 'SAME_AS ' + match.title, match.eventId); return 'DUPLICATE';}
  if (match) {await save('REVIEW', 'SIMILAR_TO ' + match.title, match.eventId); return 'REVIEW';}
  if (review) {await save('REVIEW', review); return 'REVIEW';}
  const created = await db.$transaction(async tx => {
    const event = await createEvent(tx, ready.data, source.url, context.now);
    if (!event) return null;
    const data = {status: 'IMPORTED' as const, note: null, eventId: event.id, payload: json(payload), dedupeKey: event.dedupeKey};
    // The unique (sourceId, externalId) index makes a concurrent run fail here and roll its event back.
    if (existing) {
      const changed = await tx.importedItem.updateMany({where: {id: existing.id, status: 'PENDING'}, data});
      if (!changed.count) throw new Error('IMPORT_RACE');
      return {eventId: event.id, itemId: existing.id};
    }
    return {eventId: event.id, itemId: (await tx.importedItem.create({data: {sourceId: source.id, externalId: item.externalId, ...data}})).id};
  });
  if (!created) {await save('REJECTED', 'PAST'); return 'REJECTED';}
  await ensureShortCode(created.eventId).catch(() => null);
  // The content hash and the time of this last write: what later runs compare the feed and the event against.
  await stampItem(created.itemId, created.eventId, payload).catch(() => null);
  return 'IMPORTED';
}
async function importNews(source: Pick<ImportSource, 'id' | 'cityId'>, body: string, now: Date) {
  const news = await parseNews(body, now);
  const known = new Set((await db.newsItem.findMany({where: {url: {in: news.map(item => item.url)}}, select: {url: true}})).map(item => item.url));
  const fresh = news.filter(item => !known.has(item.url));
  const created = fresh.length ? (await db.newsItem.createMany({skipDuplicates: true,
    data: fresh.map(item => ({sourceId: source.id, url: item.url, title: item.title, summary: item.summary ?? null, publishedAt: item.publishedAt, cityId: source.cityId}))})).count : 0;
  return {NEWS: created, SKIPPED: news.length - created};
}
const ACCEPT = {RSS: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
  ICAL: 'text/calendar, */*;q=0.1', SCHEMA_ORG: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1'};
export async function parseSource(source: Pick<ImportSource, 'kind'>, body: string, url: string, now: Date): Promise<ParsedEvent[]> {
  return source.kind === 'ICAL' ? parseIcal(body, now) : source.kind === 'RSS' ? parseRssEvents(body) : parseSchemaOrg(body, url);
}
const LOCK_SECONDS = 600;
export async function runSource(sourceId: string, options: {now?: Date; force?: boolean} = {}): Promise<RunResult> {
  const now = options.now ?? new Date(), counts: Record<string, number> = {};
  const source = await db.importSource.findUnique({where: {id: sourceId}}).catch(() => null);
  if (!source) return {sourceId, ok: false, skipped: 'NOT_FOUND', error: 'NOT_FOUND', counts};
  if (!source.enabled && !options.force) return {sourceId, ok: true, skipped: 'DISABLED', counts};
  // Two workers (or the worker and a manual trigger) never fetch the same source at once. Without Redis the unique index still prevents duplicates.
  const lock = 'import:lock:' + source.id;
  if (await withRedis(redis => redis.set(lock, '1', 'EX', LOCK_SECONDS, 'NX')) === null) return {sourceId, ok: true, skipped: 'LOCKED', counts};
  const previous = readState(source.lastStatus);
  let state: SourceState, result: RunResult;
  try {
    // A web page is read the way a crawler reads it, so robots.txt applies (also to where it redirects). Feeds that a
    // site publishes for syndication are fetched regardless; both stay behind the per-host pause.
    const response = await safeFetch(source.url, {accept: ACCEPT[source.kind], ...(source.kind === 'SCHEMA_ORG' ? {check: assertRobots} : {}),
      ...(options.force ? {} : {etag: previous.etag, lastModified: previous.lastModified})});
    if (!response.notModified) {
      if (source.news) Object.assign(counts, await importNews(source, response.body, now));
      else {
        const context: Context = {now, cities: await loadCities(), geocodes: 0};
        const parsed = await parseSource(source, response.body, response.url, now);
        for (const item of parsed) {
          let status: string;
          // One malformed item (or a lost race for it) does not stop the rest of the feed.
          try {status = await processItem(source, item, context);} catch (error) {
            status = 'FAILED';
            log('warn', 'import_item_failed', {sourceId, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'});
          }
          counts[status] = (counts[status] || 0) + 1;
        }
        // Only a complete listing can tell that an item is gone: a calendar or a page, not cut off by the per-run
        // limit and read without a failure. An RSS feed is a window of the latest entries and proves nothing.
        if (source.kind !== 'RSS' && parsed.length > 0 && parsed.length < MAX_ITEMS && !counts.FAILED) {
          const missing = await sweepMissing(source.id, parsed.map(item => item.externalId).filter(Boolean), now).catch(error => {
            log('warn', 'import_missing_failed', {sourceId, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'});
            return {} as Record<string, number>;
          });
          for (const [status, count] of Object.entries(missing)) counts[status] = (counts[status] || 0) + count;
        }
      }
    }
    state = {ok: true, at: now.toISOString(), http: response.status, etag: response.etag, lastModified: response.lastModified, failures: 0,
      counts: response.notModified ? previous.counts : counts};
    result = {sourceId, ok: true, notModified: response.notModified, counts};
  } catch (error) {
    const code = error instanceof ImportFetchError ? error.code : error instanceof Error ? error.message.slice(0, 200) : 'unknown';
    // Validators are kept, so the next successful run can still be a conditional request.
    state = {ok: false, at: now.toISOString(), http: error instanceof ImportFetchError ? error.status : undefined, etag: previous.etag, lastModified: previous.lastModified,
      failures: (previous.failures || 0) + 1, error: code};
    result = {sourceId, ok: false, error: code, counts};
  }
  await db.importSource.update({where: {id: source.id}, data: {lastRunAt: now, lastStatus: JSON.stringify(state)}}).catch(() => null);
  await withRedis(redis => redis.del(lock));
  log(result.ok ? 'info' : 'warn', 'import_source', {sourceId, kind: source.kind, ok: result.ok, notModified: result.notModified, error: result.error, counts});
  return result;
}
// Items approved in the admin panel (REVIEW → PENDING with note APPROVED) become events here, whether or not the
// feed still lists them.
export async function processApproved(now = new Date(), limit = 100, sourceId?: string) {
  const items = await db.importedItem.findMany({where: {status: 'PENDING', note: 'APPROVED', ...(sourceId ? {sourceId} : {})}, include: {source: {select: {url: true}}}, orderBy: {createdAt: 'asc'}, take: limit});
  const counts: Record<string, number> = {};
  for (const item of items) {
    let status: string;
    try {status = (await importApproved(item, null, now)).status;} catch (error) {
      status = 'FAILED';
      log('warn', 'import_approved_failed', {itemId: item.id, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'});
    }
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}
