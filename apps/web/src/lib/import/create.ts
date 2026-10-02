import {createHash, randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {z} from 'zod';
import {db, Prisma, type ImportedItem, type ImportStatus} from '@dance/db';
import {allStyles} from '../catalogue/data';
import {normalize} from '../catalogue/search';
import {ensureShortCode} from '../events/short-code';
import {announceCancellation} from '../events/cancel';
import {dedupeKey, distanceM, titleSimilarity} from './dedupe';
// What the pipeline stores in ImportedItem.payload: the item after timezone, city and coordinates were resolved.
// Dates are ISO strings. Rejected items may lack a date or a city; anything that becomes an Event passes `ready`.
const iso = z.iso.datetime();
const text = (max: number) => z.string().max(max).nullable();
export const payloadSchema = z.object({
  title: z.string().max(120), description: text(5000), startsAt: iso.nullable(), endsAt: iso.nullable(),
  timezone: text(64), cityId: text(64), venueName: text(160), address: text(300),
  lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(), precise: z.boolean(),
  url: text(2000), rrule: text(200), sourceRrule: text(200), allDay: z.boolean(),
  occurrences: z.array(z.object({startsAt: iso, endsAt: iso.nullable()})).max(60)
});
export type Payload = z.infer<typeof payloadSchema>;
const ready = payloadSchema.extend({title: z.string().min(1).max(120), startsAt: iso, timezone: z.string().min(1).max(64), cityId: z.string().min(1).max(64)});
export type ReadyPayload = z.infer<typeof ready>;
export const payloadKey = (payload: ReadyPayload, startsAt = new Date(payload.startsAt)) =>
  dedupeKey({title: payload.title, startsAt, timezone: payload.timezone, cityId: payload.cityId, lat: payload.lat, lng: payload.lng, precise: payload.precise});
const KINDS: [RegExp, 'FESTIVAL' | 'WORKSHOP' | 'CLASS' | 'PRACTICE' | 'SOCIAL'][] = [
  [/\b(festival|exchange|camp|weekender)\b|фестивал|кэмп/i, 'FESTIVAL'], [/\b(workshop|taller|intensivo)\b|воркшоп|мастер-класс|интенсив/i, 'WORKSHOP'],
  [/\b(class|classes|course|clase|clases|curso|lesson)\b|занят|урок|курс/i, 'CLASS'], [/\b(practice|practica|práctica)\b|практик/i, 'PRACTICE'],
  [/\b(social|party|fiesta|ball|milonga|jam)\b|вечеринк|танцы/i, 'SOCIAL']];
export const guessKind = (title: string) => KINDS.find(([pattern]) => pattern.test(title))?.[1] ?? 'OTHER' as const;
// Styles named in the title or at the start of the description, so that imported events show up under style filters.
async function styleIds(payload: ReadyPayload) {
  const haystack = ' ' + normalize(payload.title + ' ' + (payload.description || '').slice(0, 300)) + ' ';
  return (await allStyles()).filter(style => normalize(style.name).length >= 4 && haystack.includes(' ' + normalize(style.name) + ' ')).slice(0, 3).map(style => style.id);
}
// A known venue is reused when the item points at it; venues are never created from a feed.
async function venueId(tx: Prisma.TransactionClient, payload: ReadyPayload) {
  if (!payload.precise || payload.lat === null || payload.lng === null) return null;
  const point = {lat: payload.lat, lng: payload.lng}, box = 0.003;
  const near = await tx.venue.findMany({where: {cityId: payload.cityId, hiddenAt: null, lat: {gte: point.lat - box, lte: point.lat + box}, lng: {gte: point.lng - box, lte: point.lng + box}}, take: 50});
  return near.map(venue => ({venue, metres: distanceM(venue, point)}))
    .filter(({venue, metres}) => metres <= 40 || (metres <= 250 && !!payload.venueName && titleSimilarity(venue.name, payload.venueName) >= 0.6))
    .sort((a, b) => a.metres - b.metres)[0]?.venue.id ?? null;
}
type Dates = {startsAt: Date; endsAt: Date | null}[];
// The columns and dates an item stands for. Null when every date has passed or the city is gone.
async function eventShape(tx: Prisma.TransactionClient, input: ReadyPayload, sourceUrl: string, now: Date) {
  const seen = new Set<number>();
  let dates: Dates = input.occurrences.map(date => ({startsAt: new Date(date.startsAt), endsAt: date.endsAt ? new Date(date.endsAt) : null}))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).filter(date => !seen.has(date.startsAt.getTime()) && !!seen.add(date.startsAt.getTime()));
  if (!dates.length) dates = [{startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null}];
  // A weekly series keeps all its dates (they belong to the rule); a list of single dates keeps only what is ahead.
  if (input.rrule ? dates[dates.length - 1].startsAt < now : !(dates = dates.filter(date => date.startsAt >= now)).length) return null;
  const city = await tx.city.findUnique({where: {id: input.cityId}, select: {id: true, lat: true, lng: true}});
  if (!city) return null;
  const where = [input.venueName, input.address && input.address !== input.venueName ? input.address : null].filter(Boolean).join(' — ');
  const description = [input.description, where].filter(Boolean).join('\n\n').slice(0, 5000) || null;
  return {dates, fields: {
    title: input.title, description, startsAt: dates[0].startsAt, endsAt: dates[0].endsAt,
    timezone: input.timezone, rrule: input.rrule, cityId: city.id, venueId: await venueId(tx, input),
    lat: input.precise && input.lat !== null ? input.lat : city.lat, lng: input.precise && input.lng !== null ? input.lng : city.lng,
    kind: guessKind(input.title), sourceUrl: (input.url || sourceUrl).slice(0, 2000), dedupeKey: payloadKey(input, dates[0].startsAt)}};
}
// Creates the published, ownerless event of an imported item. Returns null when every date has passed.
export async function createEvent(tx: Prisma.TransactionClient, input: ReadyPayload, sourceUrl: string, now = new Date()) {
  const shape = await eventShape(tx, input, sourceUrl, now);
  if (!shape) return null;
  const styles = await styleIds(input);
  return tx.event.create({data: {
    slug: 'event-' + randomUUID(), ...shape.fields, status: 'PUBLISHED',
    // No membership rows: an imported event has no owner until an organizer claims it.
    styles: {create: styles.map(styleId => ({styleId}))}, occurrences: {create: shape.dates}
  }});
}
// Rewrites an imported event from what its source says now. Dates that already passed stay as they are (with the
// answers people gave for them); upcoming dates are replaced, keeping the rows whose start did not move.
// Returns null — and changes nothing — when the new version has no date ahead.
export async function updateEvent(tx: Prisma.TransactionClient, eventId: string, input: ReadyPayload, sourceUrl: string, now = new Date()) {
  const shape = await eventShape(tx, input, sourceUrl, now);
  if (!shape) return null;
  const existing = await tx.eventOccurrence.findMany({where: {eventId, startsAt: {gte: now}}, select: {id: true, startsAt: true, endsAt: true}});
  const wanted = new Map(shape.dates.filter(date => date.startsAt >= now).map(date => [date.startsAt.getTime(), date])), kept = new Set<number>();
  for (const row of existing) {
    const match = wanted.get(row.startsAt.getTime());
    if (!match) continue;
    kept.add(row.startsAt.getTime());
    if ((row.endsAt?.getTime() ?? null) !== (match.endsAt?.getTime() ?? null)) await tx.eventOccurrence.update({where: {id: row.id}, data: {endsAt: match.endsAt}});
  }
  await tx.eventOccurrence.deleteMany({where: {id: {in: existing.filter(row => !kept.has(row.startsAt.getTime())).map(row => row.id)}}});
  const added = [...wanted.values()].filter(date => !kept.has(date.startsAt.getTime()));
  if (added.length) await tx.eventOccurrence.createMany({data: added.map(date => ({eventId, ...date})), skipDuplicates: true});
  return tx.event.update({where: {id: eventId}, data: shape.fields});
}
// ---------- following the source ----------
// ImportedItem.payload.sync: what the importer needs to tell "the feed changed" from "a person changed the event".
//   hash      — content hash of the payload the event was last written from;
//   writtenAt — Event.updatedAt right after the importer's last write: any later change was made by somebody else;
//   missing   — consecutive full runs of the source that no longer listed the item;
//   pending   — set on a REVIEW item whose source changed (UPDATE) or cancelled / dropped it (CANCEL) while the event
//               was in human hands: approving it applies that to the existing event instead of creating another one.
export type SyncState = {hash?: string; writtenAt?: string; missing?: number; pending?: 'UPDATE' | 'CANCEL'};
export function readSync(payload: unknown): SyncState {
  const raw = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as {sync?: unknown}).sync : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const {hash, writtenAt, missing, pending} = raw as Record<string, unknown>;
  return {...(typeof hash === 'string' ? {hash} : {}), ...(typeof writtenAt === 'string' ? {writtenAt} : {}),
    ...(typeof missing === 'number' && missing > 0 ? {missing: Math.floor(missing)} : {}), ...(pending === 'UPDATE' || pending === 'CANCEL' ? {pending} : {})};
}
/**
 * Hash of everything a person would call "the event": title, text, place, link and schedule. A weekly series is
 * described by its source rule, weekday, local time and duration — not by its next date or the number of dates left,
 * which change every week by themselves. Plain dates are compared separately (futureDates), again because dates
 * that pass must not look like a change.
 */
export function contentHash(payload: Payload) {
  const start = payload.startsAt && payload.timezone ? DateTime.fromISO(payload.startsAt, {zone: payload.timezone}) : null;
  const series = payload.rrule && start?.isValid ? [payload.sourceRrule, start.weekday, start.toFormat('HH:mm'),
    payload.endsAt ? Date.parse(payload.endsAt) - Date.parse(payload.startsAt!) : null] : null;
  return createHash('sha256').update(JSON.stringify([payload.title, payload.description, payload.timezone, payload.cityId, payload.venueName, payload.address,
    payload.lat, payload.lng, payload.precise, payload.url, payload.allDay, series])).digest('hex').slice(0, 32);
}
export function futureDates(payload: Payload, now: Date) {
  if (payload.rrule) return '';
  const dates = payload.occurrences.length ? payload.occurrences : payload.startsAt ? [{startsAt: payload.startsAt, endsAt: payload.endsAt}] : [];
  return dates.filter(date => Date.parse(date.startsAt) >= now.getTime()).map(date => new Date(date.startsAt).toISOString() + '/' + (date.endsAt ? new Date(date.endsAt).toISOString() : '')).sort().join(',');
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
export const withSync = (payload: Payload, sync: SyncState) => json({...payload, sync});
// Records the importer's write: call it after everything the importer does to the event (including the short code).
export async function stampItem(itemId: string, eventId: string, payload: Payload) {
  const event = await db.event.findUnique({where: {id: eventId}, select: {updatedAt: true}});
  if (event) await db.importedItem.update({where: {id: itemId}, data: {payload: withSync(payload, {hash: contentHash(payload), writtenAt: event.updatedAt.toISOString()})}});
}
// Cancels the event of an item the source cancelled or dropped, and tells the people who planned to come — once:
// only the change from published to cancelled announces anything.
export async function cancelImported(eventId: string, now = new Date()) {
  const changed = await db.event.updateMany({where: {id: eventId, status: 'PUBLISHED'}, data: {status: 'CANCELLED'}});
  if (!changed.count) return false;
  if (await db.eventOccurrence.count({where: {eventId, cancelled: false, startsAt: {gte: now}}})) await announceCancellation(eventId).catch(error =>
    console.warn(JSON.stringify({level: 'warn', event: 'import_cancel_notice_failed', eventId, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'})));
  return true;
}
export type Outcome = {status: ImportStatus; eventId: string | null; note: string | null};
// An item confirmed by staff becomes an event without another de-duplication pass. `from` is the state it must still be in,
// so two reviewers (or the admin panel and the worker) cannot create the event twice.
export async function importApproved(item: Pick<ImportedItem, 'id' | 'status' | 'payload' | 'note'> & {eventId?: string | null; source: {url: string}}, actorUserId: string | null, now = new Date()): Promise<Outcome> {
  const parsed = ready.safeParse(item.payload), pending = item.eventId ? readSync(item.payload).pending : undefined;
  // Staff accepted what the source says about an event that people had edited: it is applied to that event.
  const target = pending ? await db.event.findUnique({where: {id: item.eventId!}, select: {id: true}}) : null;
  if (pending === 'CANCEL' && target) {
    const changed = await db.importedItem.updateMany({where: {id: item.id, status: item.status, note: item.note}, data: {status: 'REJECTED', note: 'CANCELLED'}});
    if (!changed.count) throw new ReviewError('ALREADY_DECIDED', 409);
    await cancelImported(target.id, now);
    if (actorUserId) await db.auditLog.create({data: {actorUserId, action: 'IMPORT_APPROVE', targetType: 'ImportedItem', targetId: item.id, data: {result: 'CANCELLED', eventId: target.id, note: null}}});
    return {status: 'REJECTED', eventId: target.id, note: 'CANCELLED'};
  }
  const outcome = await db.$transaction(async tx => {
    const event = !parsed.success ? null : pending === 'UPDATE' && target ? await updateEvent(tx, target.id, parsed.data, item.source.url, now)
      : await createEvent(tx, parsed.data, item.source.url, now);
    const next: Outcome = event ? {status: 'IMPORTED', eventId: event.id, note: 'APPROVED'}
      : {status: 'REJECTED', eventId: null, note: parsed.success ? 'PAST' : 'INVALID_PAYLOAD'};
    const changed = await tx.importedItem.updateMany({where: {id: item.id, status: item.status, note: item.note}, data: {status: next.status, note: next.note,
      ...(event ? {eventId: event.id, dedupeKey: event.dedupeKey} : {})}});
    if (!changed.count) throw new ReviewError('ALREADY_DECIDED', 409);
    if (actorUserId) await tx.auditLog.create({data: {actorUserId, action: 'IMPORT_APPROVE', targetType: 'ImportedItem', targetId: item.id,
      data: {result: next.status, eventId: next.eventId, note: event ? null : next.note}}});
    return next;
  });
  if (outcome.eventId && parsed.success) {
    await ensureShortCode(outcome.eventId).catch(() => null);
    await stampItem(item.id, outcome.eventId, parsed.data).catch(() => null);
  }
  return outcome;
}
export class ReviewError extends Error {
  constructor(public code: string, public status: number) {super(code);}
}
export {ready as readyPayload};
