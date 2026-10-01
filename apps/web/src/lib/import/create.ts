import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db, Prisma, type ImportedItem, type ImportStatus} from '@dance/db';
import {allStyles} from '../catalogue/data';
import {normalize} from '../catalogue/search';
import {ensureShortCode} from '../events/short-code';
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
export const guessKind = (title: string) => KINDS.find(([pattern]) => pattern.test(title))?.[1] ?? 'OTHER';
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
// Creates the published, ownerless event of an imported item. Returns null when every date has passed.
export async function createEvent(tx: Prisma.TransactionClient, input: ReadyPayload, sourceUrl: string, now = new Date()) {
  const seen = new Set<number>();
  let dates = input.occurrences.map(date => ({startsAt: new Date(date.startsAt), endsAt: date.endsAt ? new Date(date.endsAt) : null}))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).filter(date => !seen.has(date.startsAt.getTime()) && !!seen.add(date.startsAt.getTime()));
  if (!dates.length) dates = [{startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null}];
  // A weekly series keeps all its dates (they belong to the rule); a list of single dates keeps only what is ahead.
  if (input.rrule ? dates[dates.length - 1].startsAt < now : !(dates = dates.filter(date => date.startsAt >= now)).length) return null;
  const city = await tx.city.findUnique({where: {id: input.cityId}, select: {id: true, lat: true, lng: true}});
  if (!city) return null;
  const where = [input.venueName, input.address && input.address !== input.venueName ? input.address : null].filter(Boolean).join(' — ');
  const description = [input.description, where].filter(Boolean).join('\n\n').slice(0, 5000) || null;
  const [styles, venue] = [await styleIds(input), await venueId(tx, input)];
  return tx.event.create({data: {
    slug: 'event-' + randomUUID(), title: input.title, description, startsAt: dates[0].startsAt, endsAt: dates[0].endsAt,
    timezone: input.timezone, rrule: input.rrule, cityId: city.id, venueId: venue,
    lat: input.precise && input.lat !== null ? input.lat : city.lat, lng: input.precise && input.lng !== null ? input.lng : city.lng,
    status: 'PUBLISHED', kind: guessKind(input.title), sourceUrl: (input.url || sourceUrl).slice(0, 2000),
    dedupeKey: payloadKey(input, dates[0].startsAt),
    // No membership rows: an imported event has no owner until an organizer claims it.
    styles: {create: styles.map(styleId => ({styleId}))}, occurrences: {create: dates}
  }});
}
export type Outcome = {status: ImportStatus; eventId: string | null; note: string | null};
// An item confirmed by staff becomes an event without another de-duplication pass. `from` is the state it must still be in,
// so two reviewers (or the admin panel and the worker) cannot create the event twice.
export async function importApproved(item: Pick<ImportedItem, 'id' | 'status' | 'payload' | 'note'> & {source: {url: string}}, actorUserId: string | null, now = new Date()): Promise<Outcome> {
  const parsed = ready.safeParse(item.payload);
  const outcome = await db.$transaction(async tx => {
    const event = parsed.success ? await createEvent(tx, parsed.data, item.source.url, now) : null;
    const next: Outcome = event ? {status: 'IMPORTED', eventId: event.id, note: 'APPROVED'}
      : {status: 'REJECTED', eventId: null, note: parsed.success ? 'PAST' : 'INVALID_PAYLOAD'};
    const changed = await tx.importedItem.updateMany({where: {id: item.id, status: item.status, note: item.note}, data: {status: next.status, note: next.note,
      ...(event ? {eventId: event.id, dedupeKey: event.dedupeKey} : {})}});
    if (!changed.count) throw new ReviewError('ALREADY_DECIDED', 409);
    if (actorUserId) await tx.auditLog.create({data: {actorUserId, action: 'IMPORT_APPROVE', targetType: 'ImportedItem', targetId: item.id,
      data: {result: next.status, eventId: next.eventId, note: event ? null : next.note}}});
    return next;
  });
  if (outcome.eventId) await ensureShortCode(outcome.eventId).catch(() => null);
  return outcome;
}
export class ReviewError extends Error {
  constructor(public code: string, public status: number) {super(code);}
}
export {ready as readyPayload};
