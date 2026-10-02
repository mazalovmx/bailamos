import {db} from '@dance/db';
import type {JobDef} from '../../worker/types';
import {storage} from '../storage';
import {withRedis} from '../redis';
import {isBaseKey, parseRawKey, parseVariantKey, variantKeys} from '../media/keys';
export const RAW_MAX_AGE_MS = 24 * 3600_000, SWEEP_LIMIT = 5000;
const DAY = 86400_000;
const log = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) =>
  (level === 'error' ? console.error : console.log)(JSON.stringify({level, event, ...fields}));
const int = (name: string, fallback: number, min = 1) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && process.env[name]?.trim() ? Math.floor(value) : fallback;
};
/**
 * Deletes raw uploads that were never completed. A finished upload removes its own raw object within seconds, so
 * anything older than a day under "raw/" is abandoned. Only well-formed raw keys are touched.
 */
export async function sweepRawUploads(now = new Date(), maxAgeMs = RAW_MAX_AGE_MS) {
  const store = storage(), listed = await store.list('raw/', {limit: SWEEP_LIMIT});
  const stale = listed.filter(item => parseRawKey(item.key) && now.getTime() - item.modified.getTime() > maxAgeMs).map(item => item.key);
  if (stale.length) await store.deleteObjects(stale);
  return {driver: store.driver, scanned: listed.length, deleted: stale.length};
}
/** Base keys ("img/<profile>/<uuid>") out of `keys` that some row still points at. */
export async function referencedKeys(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const [items, avatars, covers, attachments] = await Promise.all([
    db.mediaItem.findMany({where: {storageKey: {in: keys}}, select: {storageKey: true}}),
    db.profile.findMany({where: {avatarKey: {in: keys}}, select: {avatarKey: true}}),
    db.profile.findMany({where: {coverKey: {in: keys}}, select: {coverKey: true}}),
    db.message.findMany({where: {attachmentKey: {in: keys}}, select: {attachmentKey: true}})]);
  return new Set([...items.map(row => row.storageKey), ...avatars.map(row => row.avatarKey), ...covers.map(row => row.coverKey),
    ...attachments.map(row => row.attachmentKey)].filter((key): key is string => !!key));
}
export const PURGE_WINDOW_DAYS = 30, PURGE_BATCH = 200;
/**
 * Removes the stored files of media deleted in the admin panel. The panel deletes the row and leaves an AuditLog entry
 * (action TARGET_DELETE, data.mediaKey = the storage key) — it cannot reach the object store. Every handled entry gets
 * a follow-up row MEDIA_PURGED, so a repeated or concurrent run finds nothing to do; a storage failure leaves no marker
 * and the entry is retried on the next run. A key that is still referenced elsewhere is left alone.
 * `targetIds` narrows the run to some deleted objects (used by tests).
 */
export async function purgeDeletedMedia(now = new Date(), options: {targetIds?: string[]; limit?: number} = {}) {
  const since = new Date(now.getTime() - PURGE_WINDOW_DAYS * DAY);
  const deleted = await db.auditLog.findMany({where: {action: 'TARGET_DELETE', createdAt: {gte: since}, ...(options.targetIds ? {targetId: {in: options.targetIds}} : {}), data: {path: ['mediaKey'], string_starts_with: 'img/'}},
    orderBy: {createdAt: 'asc'}, select: {id: true, targetType: true, targetId: true, data: true}});
  const done = new Set((await db.auditLog.findMany({where: {action: 'MEDIA_PURGED', createdAt: {gte: since}}, select: {data: true}}))
    .map(row => (row.data as {auditId?: unknown} | null)?.auditId).filter((id): id is string => typeof id === 'string'));
  const todo = deleted.filter(row => !done.has(row.id)).slice(0, options.limit ?? PURGE_BATCH);
  const keys = todo.map(row => String((row.data as {mediaKey?: unknown}).mediaKey)), used = await referencedKeys(keys.filter(isBaseKey));
  const store = storage();
  let purged = 0, kept = 0, failed = 0;
  for (const [index, row] of todo.entries()) {
    const key = keys[index], result = !isBaseKey(key) ? 'INVALID_KEY' : used.has(key) ? 'STILL_REFERENCED' : 'PURGED';
    try {
      if (result === 'PURGED') await store.deleteObjects(variantKeys(key));
      await db.auditLog.create({data: {actorUserId: null, action: 'MEDIA_PURGED', targetType: row.targetType, targetId: row.targetId, data: {auditId: row.id, key, result}}});
      if (result === 'PURGED') purged++; else kept++;
    } catch (error) {
      failed++;
      log('warn', 'media_purge_failed', {auditId: row.id, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'});
    }
  }
  if (failed) throw new Error('MEDIA_PURGE_INCOMPLETE ' + failed + '/' + todo.length);
  return {driver: store.driver, candidates: todo.length, purged, kept};
}
export const ORPHAN_MIN_AGE_MS = 7 * DAY, ORPHAN_SCAN = 5000, ORPHAN_CURSOR_KEY = 'media:orphans:cursor';
type OrphanOptions = {dryRun?: boolean; max?: number; scan?: number; minAgeMs?: number; prefix?: string; cursor?: boolean};
/**
 * Processed images under "img/" that no MediaItem, avatar, cover or chat attachment points at (an upload whose row
 * was removed while the store was unreachable, a deleted message, a replaced avatar). Only complete, well-formed
 * variant keys are considered, and only when every file of the image is older than a week — a fresh upload whose row
 * is about to be written is never touched. At most `max` images are removed per run (MEDIA_ORPHAN_MAX, default 500);
 * `dryRun` (or MEDIA_ORPHAN_DRY_RUN=true) only reports. The scan continues where the previous run stopped.
 */
export async function sweepOrphans(now = new Date(), options: OrphanOptions = {}) {
  const dryRun = options.dryRun ?? process.env.MEDIA_ORPHAN_DRY_RUN === 'true', max = options.max ?? int('MEDIA_ORPHAN_MAX', 500, 0);
  const scan = options.scan ?? ORPHAN_SCAN, minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS, prefix = options.prefix ?? 'img/', useCursor = options.cursor !== false;
  const store = storage(), after = useCursor ? await withRedis(redis => redis.get(ORPHAN_CURSOR_KEY)) || undefined : undefined;
  const listed = await store.list(prefix, {limit: scan, after: after?.startsWith(prefix) ? after : undefined});
  const newest = new Map<string, number>();
  for (const item of listed) {
    const base = parseVariantKey(item.key)?.base;
    if (base) newest.set(base, Math.max(newest.get(base) ?? 0, item.modified.getTime()));
  }
  // The last image of a full page may continue on the next page: it waits for the next run.
  const full = listed.length >= scan, last = full ? parseVariantKey(listed[listed.length - 1].key)?.base : undefined;
  const old = [...newest].filter(([base, modified]) => base !== last && now.getTime() - modified > minAgeMs).map(([base]) => base);
  const used = new Set<string>();
  for (let start = 0; start < old.length; start += 500) for (const key of await referencedKeys(old.slice(start, start + 500))) used.add(key);
  const orphans = old.filter(base => !used.has(base)), chosen = orphans.slice(0, max);
  if (!dryRun && chosen.length) {
    // Checked again right before deleting: a row written in the meantime wins.
    const late = await referencedKeys(chosen), doomed = chosen.filter(base => !late.has(base));
    await store.deleteObjects(doomed.flatMap(variantKeys));
    chosen.splice(0, chosen.length, ...doomed);
  }
  if (useCursor) await withRedis(async redis => {
    if (full) await redis.set(ORPHAN_CURSOR_KEY, last ? last + '/' : listed[listed.length - 1].key, 'EX', 30 * 86400); else await redis.del(ORPHAN_CURSOR_KEY);
    return null;
  });
  const result = {driver: store.driver, dryRun, scanned: listed.length, images: newest.size, orphans: orphans.length, deleted: dryRun ? 0 : chosen.length, capped: orphans.length > max};
  if (orphans.length) log('info', 'media_orphans', {...result, sample: orphans.slice(0, 5)});
  return result;
}
export const mediaJobs: JobDef[] = [
  {name: 'media.sweep', cron: '15 4 * * *', attempts: 2, handler: () => sweepRawUploads()},
  {name: 'media.purge', everyMs: 15 * 60_000, attempts: 3, handler: () => purgeDeletedMedia()},
  // On demand with {dryRun: true} for a report without deletions.
  {name: 'media.orphans', cron: '45 4 * * *', attempts: 2, handler: data => sweepOrphans(new Date(), data.dryRun === true ? {dryRun: true} : {})}
];
