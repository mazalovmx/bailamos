import {db, type ImportedItem, type ImportSource} from '@dance/db';
import {ensureShortCode} from '../events/short-code';
import type {ParsedEvent} from './types';
import {cancelImported, contentHash, futureDates, payloadKey, payloadSchema, readSync, readyPayload, updateEvent, withSync, type Payload, type SyncState} from './create';
// An imported event keeps following its source — its title, time, place and text, a cancellation, a disappearance —
// for as long as nobody on the site has taken it over. Once an organizer claimed it or anybody edited it, the importer
// never writes to it again: the difference goes to manual review instead.
export type SyncOutcome = 'SKIPPED' | 'UPDATED' | 'CANCELLED' | 'REVIEW';
const LEGACY_GRACE_MS = 60_000;
export const missingRuns = () => {
  const value = Number(process.env.IMPORT_MISSING_RUNS);
  return Number.isInteger(value) && value >= 1 ? value : 3;
};
const eventSelect = {id: true, status: true, createdAt: true, updatedAt: true, schoolProfileId: true, _count: {select: {members: true}}} as const;
type EventState = {id: string; status: string; createdAt: Date; updatedAt: Date; schoolProfileId: string | null; _count: {members: number}};
/**
 * True while the event is exactly what the importer last wrote: no organizer, no school, and `updatedAt` still equal to
 * the timestamp recorded after that write. Items imported before the timestamp was recorded count as untouched only
 * when the event was never updated after its creation (the short code is written within the same second).
 */
export function untouched(event: EventState, sync: SyncState) {
  if (event._count.members > 0 || event.schoolProfileId) return false;
  return sync.writtenAt ? event.updatedAt.getTime() === Date.parse(sync.writtenAt) : event.updatedAt.getTime() - event.createdAt.getTime() <= LEGACY_GRACE_MS;
}
const stored = (payload: unknown): Payload | null => {
  const parsed = payloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};
const quote = (value: string | null | undefined, max = 60) => value ? '"' + (value.length > max ? value.slice(0, max) + '…' : value) + '"' : '—';
// The schedule alone: the weekly pattern of a series, or the dates still ahead.
const scheduleKey = (payload: Payload, now: Date) => contentHash({...payload, title: '', description: null, venueName: null, address: null, lat: null, lng: null,
  precise: false, url: null, cityId: null}) + '|' + futureDates(payload, now);
/** One line for the reviewer: which facts differ between what was imported and what the source says now. */
export function describeChange(before: Payload | null, after: Payload, now: Date) {
  if (!before) return 'SOURCE_CHANGED';
  const parts: string[] = [];
  if (before.title !== after.title) parts.push('title: ' + quote(before.title) + ' → ' + quote(after.title));
  if (scheduleKey(before, now) !== scheduleKey(after, now)) parts.push('time: ' + (before.startsAt ?? '—') + ' → ' + (after.startsAt ?? '—'));
  if (before.venueName !== after.venueName || before.address !== after.address || before.cityId !== after.cityId || before.lat !== after.lat || before.lng !== after.lng)
    parts.push('place: ' + quote(before.address || before.venueName) + ' → ' + quote(after.address || after.venueName));
  if (before.description !== after.description) parts.push('description');
  if (before.url !== after.url) parts.push('link');
  return ('SOURCE_CHANGED ' + (parts.join('; ') || 'details')).slice(0, 300);
}
// `known` carries the coordinates found last time (or null when none were found); without it the address is geocoded.
export type Resolve = (known?: {point: {lat: number; lng: number} | null}) => Promise<{payload: Payload; reject?: string; review?: string}>;
/**
 * Called for a feed entry whose item is already IMPORTED. `resolve` turns the entry into a payload; it is given the
 * coordinates found last time when the address is unchanged, so an unchanged item costs no geocoder call.
 * Idempotent: an unchanged entry writes nothing, and every outcome leaves a state the next run skips.
 */
export async function syncImported(source: Pick<ImportSource, 'id' | 'url'>, existing: ImportedItem, entry: Pick<ParsedEvent, 'cancelled' | 'venueName' | 'address' | 'lat'>,
  resolve: Resolve, now: Date): Promise<SyncOutcome> {
  if (!existing.eventId) return 'SKIPPED';
  const eventId = existing.eventId, sync = readSync(existing.payload), before = stored(existing.payload);
  const loadEvent = () => db.event.findUnique({where: {id: eventId}, select: eventSelect});
  if (entry.cancelled) {
    const event = await loadEvent();
    if (!event) return 'SKIPPED';
    if (event.status !== 'CANCELLED' && !untouched(event, sync)) {
      await db.importedItem.update({where: {id: existing.id}, data: {status: 'REVIEW', note: 'SOURCE_CANCELLED', ...(before ? {payload: withSync(before, {...sync, pending: 'CANCEL'})} : {})}});
      return 'REVIEW';
    }
    // The item leaves the IMPORTED state first, so a second worker or a retry cannot announce the cancellation twice.
    const claimed = await db.importedItem.updateMany({where: {id: existing.id, status: 'IMPORTED'}, data: {status: 'REJECTED', note: 'CANCELLED'}});
    if (!claimed.count) return 'SKIPPED';
    await cancelImported(event.id, now);
    return 'CANCELLED';
  }
  const samePlace = !!before && (before.address ?? null) === (entry.address || null) && (before.venueName ?? null) === (entry.venueName || null);
  const resolved = await resolve(samePlace && before && entry.lat === undefined
    ? {point: before.precise && before.lat !== null && before.lng !== null ? {lat: before.lat, lng: before.lng} : null} : undefined);
  const ready = resolved.reject || resolved.review ? null : readyPayload.safeParse(resolved.payload);
  // An entry that can no longer be imported (no date, a rule we cannot read, already over) leaves the event as it is.
  if (!ready?.success) return 'SKIPPED';
  const payload = resolved.payload, hash = contentHash(payload);
  const same = hash === (sync.hash ?? (before ? contentHash(before) : null)) && (!before || futureDates(before, now) === futureDates(payload, now));
  if (same) {
    // Back in the feed after a gap: the count of missed runs starts over.
    if (sync.missing && before) await db.importedItem.update({where: {id: existing.id}, data: {payload: withSync(before, {...sync, missing: undefined})}});
    return 'SKIPPED';
  }
  const event = await loadEvent();
  if (!event || event.status === 'CANCELLED') return 'SKIPPED';
  if (!untouched(event, sync)) {
    await db.importedItem.update({where: {id: existing.id}, data: {status: 'REVIEW', note: describeChange(before, payload, now), payload: withSync(payload, {hash, pending: 'UPDATE'}), dedupeKey: payloadKey(ready.data)}});
    return 'REVIEW';
  }
  const updated = await db.$transaction(async tx => {
    // Re-checked under the transaction: an edit made a moment ago must not be overwritten.
    const current = await tx.event.findUnique({where: {id: event.id}, select: {updatedAt: true}});
    if (current?.updatedAt.getTime() !== event.updatedAt.getTime()) return null;
    const written = await updateEvent(tx, event.id, ready.data, source.url, now);
    if (!written) return null;
    await tx.importedItem.update({where: {id: existing.id}, data: {payload: withSync(payload, {hash, writtenAt: written.updatedAt.toISOString()}), dedupeKey: written.dedupeKey, note: null}});
    return written;
  });
  if (!updated) return 'SKIPPED';
  if (!updated.shortCode) await ensureShortCode(updated.id).catch(() => null);
  return 'UPDATED';
}
/**
 * After a full listing of a source: imported items it no longer mentions. Each such run is counted; after
 * IMPORT_MISSING_RUNS (3) in a row an untouched, still upcoming event is cancelled with the usual notice, and one in
 * human hands goes to review. Past events are left alone — feeds drop them as a matter of course.
 */
export async function sweepMissing(sourceId: string, seen: string[], now: Date, limit = missingRuns()) {
  const counts: Record<string, number> = {};
  const gone = await db.importedItem.findMany({where: {sourceId, status: 'IMPORTED', eventId: {not: null}, externalId: {notIn: seen},
    event: {status: 'PUBLISHED', occurrences: {some: {cancelled: false, startsAt: {gte: now}}}}}, include: {event: {select: eventSelect}}, take: 500});
  for (const item of gone) {
    const sync = readSync(item.payload), before = stored(item.payload), missing = (sync.missing || 0) + 1;
    if (!item.event || !before) continue;
    let outcome = 'MISSING';
    if (missing < limit) await db.importedItem.update({where: {id: item.id}, data: {payload: withSync(before, {...sync, missing})}});
    else if (!untouched(item.event, sync)) {
      await db.importedItem.update({where: {id: item.id}, data: {status: 'REVIEW', note: 'SOURCE_GONE', payload: withSync(before, {...sync, missing, pending: 'CANCEL'})}});
      outcome = 'REVIEW';
    } else if ((await db.importedItem.updateMany({where: {id: item.id, status: 'IMPORTED'}, data: {status: 'REJECTED', note: 'GONE_FROM_SOURCE'}})).count) {
      await cancelImported(item.event.id, now);
      outcome = 'CANCELLED';
    }
    counts[outcome] = (counts[outcome] || 0) + 1;
  }
  return counts;
}
