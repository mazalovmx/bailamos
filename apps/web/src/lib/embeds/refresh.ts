import {db, Prisma} from '@dance/db';
import type {JobDef} from '../../worker/types';
import {embedMeta} from '../media/dto';
import {withRedis} from '../redis';
import {fetchOEmbed, warmEmbedCache, type EmbedEntry, type Fetched} from './instagram';
// Background refresh of Instagram cards. The specification allows one upstream request per post per day and wants
// pages to survive a Meta outage: so the worker — not a page view — re-asks oEmbed for posts whose copy is getting
// old, a few at a time, and the answer goes to Postgres (the durable copy) and Redis (what pages read).
const HOUR = 3600_000, DAY_SEC = 86_400;
export const STALE_MS = 20 * HOUR;
export const BUDGET_KEY = 'embed:ig:budget:', BACKOFF_KEY = 'embed:ig:backoff', BACKOFF_STEP_KEY = 'embed:ig:backoff:step';
const BACKOFF_MIN_SEC = 900, BACKOFF_MAX_SEC = 6 * 3600, OUTAGE_AFTER = 3;
const int = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name]?.trim() ? Math.floor(value) : fallback;
};
const log = (level: 'info' | 'warn', event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({level, event, ...fields}));
// Process-local stand-ins, used only when Redis is not available (a single worker then still respects the limits).
const local = {hour: '', used: 0, backoffUntil: 0, step: 0};
export const resetEmbedRefreshState = () => {Object.assign(local, {hour: '', used: 0, backoffUntil: 0, step: 0});};
/** Takes one request out of this hour's upstream budget, shared by all workers. False when the hour is used up. */
export async function takeBudget(now: number, perHour = int('EMBED_REFRESH_PER_HOUR', 120)) {
  const hour = new Date(now).toISOString().slice(0, 13), key = BUDGET_KEY + hour;
  const used = await withRedis(async redis => {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2 * 3600);
    return count;
  });
  if (used !== undefined) return used <= perHour;
  if (local.hour !== hour) Object.assign(local, {hour, used: 0});
  return ++local.used <= perHour;
}
async function backoffLeft(now: number) {
  const ttl = await withRedis(redis => redis.ttl(BACKOFF_KEY));
  return ttl !== undefined ? Math.max(ttl, 0) : Math.max(Math.ceil((local.backoffUntil - now) / 1000), 0);
}
// Each refusal in a row doubles the pause: 15 min, 30 min, … up to 6 h. A successful answer resets it.
async function backOff(now: number) {
  const step = await withRedis(async redis => {
    const next = await redis.incr(BACKOFF_STEP_KEY);
    await redis.expire(BACKOFF_STEP_KEY, 2 * DAY_SEC);
    return next;
  }) ?? ++local.step;
  const seconds = Math.min(BACKOFF_MIN_SEC * 2 ** Math.min(step - 1, 10), BACKOFF_MAX_SEC);
  local.backoffUntil = now + seconds * 1000;
  await withRedis(redis => redis.set(BACKOFF_KEY, String(step), 'EX', seconds));
  return seconds;
}
async function clearBackoff() {
  local.step = 0;
  await withRedis(redis => redis.del(BACKOFF_STEP_KEY));
}
export type RefreshDeps = {fetch?: typeof fetch; now?: () => number; batch?: number; perHour?: number; permalinks?: string[]};
/**
 * One pass. Posts are taken oldest copy first; each costs one upstream request and is not asked again for ~20 h:
 *  - an answer replaces the card of every MediaItem embedding the post and warms the Redis cache for a day;
 *  - 404 (deleted or made private) keeps the last good card and the link and marks the rows `gone` in embedMeta; the
 *    post is asked about again a day later, because a private post can come back — user content is never deleted;
 *  - a post another MediaItem fetched within the day is copied from that row without an upstream request;
 *  - 429 or another 4xx (token, quota) stops the pass and pauses all workers with a growing delay;
 *  - timeouts and 5xx leave the stored copy in place; three in a row end the pass (Meta is down — pages keep
 *    showing what we have).
 * `permalinks` narrows the pass (used by tests).
 */
export async function refreshEmbeds(deps: RefreshDeps = {}) {
  const now = (deps.now ?? Date.now)(), batch = deps.batch ?? int('EMBED_REFRESH_BATCH', 25);
  const result = {candidates: 0, refreshed: 0, copied: 0, gone: 0, failed: 0, stopped: null as null | 'BACKOFF' | 'BUDGET' | 'REFUSED' | 'OUTAGE'};
  if (await backoffLeft(now) > 0) return {...result, stopped: 'BACKOFF' as const};
  // Never fetched (added while Meta was unreachable) first, then the oldest copies.
  const due = await db.mediaItem.findMany({distinct: ['sourceUrl'], orderBy: [{embedFetched: {sort: 'asc', nulls: 'first'}}, {id: 'asc'}], take: batch, select: {sourceUrl: true},
    where: {kind: 'instagram', sourceUrl: deps.permalinks ? {in: deps.permalinks} : {startsWith: 'https://www.instagram.com/'},
      OR: [{embedFetched: null}, {embedFetched: {lt: new Date(now - STALE_MS)}}]}});
  result.candidates = due.length;
  let outage = 0;
  for (const {sourceUrl: permalink} of due) {
    if (!permalink) continue;
    const where = {kind: 'instagram', sourceUrl: permalink};
    const newest = await db.mediaItem.findFirst({where: {...where, embedFetched: {gte: new Date(now - STALE_MS)}}, orderBy: {embedFetched: 'desc'}, select: {embedHtml: true, embedMeta: true, embedFetched: true}});
    if (newest?.embedFetched) {
      await db.mediaItem.updateMany({where: {...where, OR: [{embedFetched: null}, {embedFetched: {lt: newest.embedFetched}}]},
        data: {embedHtml: newest.embedHtml, embedMeta: newest.embedMeta ?? Prisma.JsonNull, embedFetched: newest.embedFetched}});
      result.copied++;
      continue;
    }
    if (!await takeBudget(now, deps.perHour)) {result.stopped = 'BUDGET'; break;}
    const fresh: Fetched = await fetchOEmbed(permalink, deps.fetch);
    if (fresh.ok) {
      outage = 0;
      const entry: EmbedEntry = {status: 'ok', meta: fresh.meta, html: fresh.html, fetchedAt: now};
      await db.mediaItem.updateMany({where, data: {embedHtml: entry.html ?? null, embedMeta: entry.meta, embedFetched: new Date(now)}});
      await warmEmbedCache(permalink, entry, DAY_SEC, now);
      result.refreshed++;
      if (result.refreshed === 1) await clearBackoff();
    } else if (fresh.gone) {
      outage = 0;
      const rows = await db.mediaItem.findMany({where, select: {id: true, embedMeta: true, embedHtml: true}});
      for (const row of rows) {
        const kept = row.embedMeta && typeof row.embedMeta === 'object' && !Array.isArray(row.embedMeta) ? row.embedMeta as Prisma.JsonObject : {};
        await db.mediaItem.update({where: {id: row.id}, data: {embedFetched: new Date(now), embedMeta: {...kept, gone: true, goneAt: kept.goneAt ?? new Date(now).toISOString()}}});
      }
      const last = rows.find(row => row.embedHtml || Object.values(embedMeta(row.embedMeta)).some(Boolean));
      await warmEmbedCache(permalink, last ? {status: 'ok', meta: embedMeta(last.embedMeta), html: last.embedHtml || undefined, fetchedAt: now} : {status: 'degraded', meta: {}, fetchedAt: now}, DAY_SEC, now);
      result.gone++;
    } else if (fresh.status && fresh.status >= 400 && fresh.status < 500) {
      result.failed++;
      result.stopped = 'REFUSED';
      log('warn', 'embed_refresh_refused', {status: fresh.status, pauseSec: await backOff(now)});
      break;
    } else {
      result.failed++;
      if (++outage >= OUTAGE_AFTER) {result.stopped = 'OUTAGE'; break;}
    }
  }
  if (result.candidates) log('info', 'embed_refresh', result);
  return result;
}
export const embedJobs: JobDef[] = [
  // Small batches spread over the day; failures are part of the result, so the queue has nothing to retry.
  {name: 'embeds.refresh', everyMs: 30 * 60_000, attempts: 1, handler: () => refreshEmbeds()}
];
