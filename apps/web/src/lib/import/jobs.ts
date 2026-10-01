import {db} from '@dance/db';
import type {JobDef} from '../../worker/types';
import {processApproved, readState, runSource, type RunResult} from './run';
// Background jobs of the importer. Nothing here is on the request path of the site: a source that is down, slow or
// malicious costs one log line and a `lastStatus` entry.
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const hours = () => {
  const value = Number(process.env.IMPORT_INTERVAL_HOURS);
  return Number.isFinite(value) && value > 0 ? value : 6;
};
export const MAX_FAILURES = 3, NEWS_DAYS = 90;
// A healthy source is fetched every IMPORT_INTERVAL_HOURS. A failed one is retried sooner, with a growing pause
// (30 min, 1 h), and after three failures in a row it falls back to the normal rhythm.
export function isDue(source: {lastRunAt: Date | null; lastStatus: string | null}, now: Date, intervalHours = hours()) {
  if (!source.lastRunAt) return true;
  const age = now.getTime() - source.lastRunAt.getTime(), state = readState(source.lastStatus), failures = state.failures || 0;
  if (state.ok === false && failures < MAX_FAILURES) return age >= 30 * MINUTE * 2 ** Math.max(failures - 1, 0) - MINUTE;
  return age >= intervalHours * HOUR - MINUTE;
}
const BUDGET_MS = 20 * MINUTE;
export async function runDueSources(now = new Date()) {
  const started = Date.now(), results: RunResult[] = [];
  const approved = await processApproved(now).catch(() => ({FAILED: 1}));
  const sources = await db.importSource.findMany({where: {enabled: true}, orderBy: [{lastRunAt: {sort: 'asc', nulls: 'first'}}], select: {id: true, lastRunAt: true, lastStatus: true}});
  // One after another: sources of one host never overlap, and the fetcher adds the per-host pause between them.
  for (const source of sources.filter(candidate => isDue(candidate, now))) {
    // What does not fit into this tick is picked up by the next one, oldest first.
    if (Date.now() - started > BUDGET_MS) break;
    results.push(await runSource(source.id).catch(error => ({sourceId: source.id, ok: false, error: error instanceof Error ? error.message : 'unknown', counts: {}})));
  }
  return {approved, sources: results.length, failed: results.filter(result => !result.ok).length};
}
// `sourceId` narrows the clean-up to one source (used by tests).
export async function pruneNews(now = new Date(), sourceId?: string) {
  return {deleted: (await db.newsItem.deleteMany({where: {publishedAt: {lt: new Date(now.getTime() - NEWS_DAYS * 24 * HOUR)}, ...(sourceId ? {sourceId} : {})}})).count};
}
export const importJobs: JobDef[] = [
  {name: 'import.sources', everyMs: 30 * MINUTE, attempts: 3, handler: () => runDueSources()},
  // On demand: {sourceId, force?}. Throws on failure so that the queue retries it with backoff.
  {name: 'import.source', attempts: 3, handler: async data => {
    const result = await runSource(String(data.sourceId || ''), {force: data.force === true});
    if (!result.ok) throw new Error('IMPORT_FAILED ' + (result.error || ''));
    return result;
  }},
  {name: 'import.news.prune', cron: '17 4 * * *', attempts: 3, handler: () => pruneNews()}
];
