import {randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {withRedis, redisConfigured} from '../redis';
import {HEARTBEAT_KEY} from '../../worker/keys';
import {workerHeartbeat} from '../../worker/health';
// Alerting without an external service. Request errors (instrumentation.ts) and jobs that failed their last attempt
// (worker) are counted in Redis sliding windows; the watchdog — a worker job every minute, plus a timer in the web
// process so that a dead worker is noticed too — compares the counts with the thresholds, checks the worker heartbeat,
// the database, Redis and the last backup, and sends at most one message per problem per cooldown.
export type ErrorKind = 'request' | 'job';
export type AlertKind = 'errors' | 'jobs' | 'worker_down' | 'database_down' | 'redis_down' | 'backup_failed' | 'backup_stale';
export const WINDOW_MS = 5 * 60_000, WORKER_GRACE_MS = 3 * 60_000, BACKUP_STALE_MS = 36 * 3600_000;
// Tests put their keys under a namespace of their own; production uses none.
let namespace = '';
export const setOpsNamespace = (value: string) => {namespace = value;};
export const KEYS = {errors: (kind: ErrorKind) => namespace + 'ops:errors:' + kind, cooldown: (kind: AlertKind) => namespace + 'ops:alert:cooldown:' + kind,
  workerMissing: () => namespace + 'ops:worker:missing-since', backup: () => namespace + 'ops:backup:last', backupExpected: () => namespace + 'ops:backup:expected-since',
  watchdog: () => namespace + 'ops:watchdog:lock', heartbeat: () => namespace + HEARTBEAT_KEY};
const WINDOW_MAX = 5000;
const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
export const alertSettings = () => ({
  errors: number('ALERT_ERRORS_PER_5MIN', 20), jobs: number('ALERT_JOB_FAILURES_PER_5MIN', 5), cooldownSec: Math.round(number('ALERT_COOLDOWN_MIN', 30) * 60),
  webhook: process.env.ALERT_WEBHOOK_URL?.trim() || '', email: process.env.ALERT_EMAIL?.trim() || ''});
export const alertsConfigured = () => {
  const {webhook, email} = alertSettings();
  return !!webhook || !!email;
};
const log = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) =>
  (level === 'error' ? console.error : console.log)(JSON.stringify({level, event, ...fields}));
// Without Redis (not configured, or down) each process still counts its own errors.
const memory = {errors: {request: [] as number[], job: [] as number[]}, cooldown: new Map<string, number>(), workerMissing: 0};
export const resetAlertMemory = () => {memory.errors = {request: [], job: []}; memory.cooldown.clear(); memory.workerMissing = 0;};
/** Counts one error. Never throws and never waits long: it runs on the error path of a request. */
export async function recordError(kind: ErrorKind, now = Date.now()) {
  const list = memory.errors[kind];
  list.push(now);
  while (list.length && (list[0] <= now - WINDOW_MS || list.length > WINDOW_MAX)) list.shift();
  const key = KEYS.errors(kind);
  await withRedis(redis => redis.multi().zadd(key, now, now + ':' + randomUUID()).zremrangebyscore(key, 0, now - WINDOW_MS)
    .zremrangebyrank(key, 0, -WINDOW_MAX - 1).expire(key, 2 * WINDOW_MS / 1000).exec()).catch(() => undefined);
}
export async function errorCount(kind: ErrorKind, now = Date.now()) {
  const shared = await withRedis(redis => redis.zcount(KEYS.errors(kind), now - WINDOW_MS + 1, '+inf'));
  return shared ?? memory.errors[kind].filter(at => at > now - WINDOW_MS).length;
}
export type Alert = {kind: AlertKind; text: string; details: Record<string, unknown>};
export type AlertDeps = {fetch?: typeof fetch; mail?: (to: string, subject: string, text: string) => Promise<boolean>; now?: () => number};
// First caller within the cooldown wins; everybody else stays quiet. Redis makes that hold across web and worker.
async function claim(kind: AlertKind, cooldownSec: number, now: number) {
  const shared = await withRedis(redis => redis.set(KEYS.cooldown(kind), new Date(now).toISOString(), 'EX', cooldownSec, 'NX'));
  if (shared !== undefined) return shared === 'OK';
  if ((memory.cooldown.get(kind) || 0) > now) return false;
  memory.cooldown.set(kind, now + cooldownSec * 1000);
  return true;
}
const site = () => {
  try {return new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').host;} catch {return 'unknown';}
};
/**
 * Sends one alert to ALERT_WEBHOOK_URL (JSON POST with a `text` field: Slack, Mattermost, Discord's /slack endpoint,
 * or Telegram's sendMessage when the URL carries ?chat_id=…) and to ALERT_EMAIL through the site's SMTP settings.
 * Returns false when it was suppressed by the cooldown or nothing is configured. The webhook URL is a secret and is
 * never logged.
 */
export async function sendAlert(alert: Alert, deps: AlertDeps = {}) {
  const settings = alertSettings(), now = (deps.now ?? Date.now)();
  if (!settings.webhook && !settings.email) return false;
  if (!await claim(alert.kind, settings.cooldownSec, now)) return false;
  const text = '[' + site() + '] ' + alert.text, delivered: string[] = [];
  if (settings.webhook) {
    try {
      const url = new URL(settings.webhook), chatId = url.hostname === 'api.telegram.org' ? url.searchParams.get('chat_id') : null;
      const response = await (deps.fetch ?? fetch)(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({text, ...(chatId ? {chat_id: chatId} : {kind: alert.kind, at: new Date(now).toISOString(), details: alert.details})})});
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) delivered.push('webhook'); else log('warn', 'alert_webhook_failed', {status: response.status});
    } catch (error) {log('warn', 'alert_webhook_failed', {message: error instanceof Error ? error.name : 'unknown'});}
  }
  if (settings.email) {
    const mail = deps.mail ?? (await import('../mail')).sendMail;
    if (await mail(settings.email, 'Alert: ' + alert.kind, text + '\n\n' + JSON.stringify(alert.details, null, 2)).catch(() => false)) delivered.push('email');
  }
  log(delivered.length ? 'warn' : 'error', delivered.length ? 'alert_sent' : 'alert_undelivered', {kind: alert.kind, delivered, details: alert.details});
  // Nobody heard it: the next pass may try again instead of waiting out the cooldown.
  if (!delivered.length) {
    memory.cooldown.delete(alert.kind);
    await withRedis(redis => redis.del(KEYS.cooldown(alert.kind)));
  }
  return delivered.length > 0;
}
const withTimeout = <T>(work: Promise<T>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([work, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);})]).finally(() => clearTimeout(timer));
};
export type Readiness = {database: 'ok' | 'down'; redis: 'ok' | 'down' | 'disabled'};
/** Can this process reach what it depends on? Used by GET /api/health/ready and by the watchdog. */
export async function readiness(timeoutMs = 2000): Promise<Readiness> {
  const [database, redis] = await Promise.all([
    withTimeout(db.$queryRaw`SELECT 1`, timeoutMs).then(() => 'ok' as const, () => 'down' as const),
    redisConfigured() ? withTimeout(withRedis(client => client.ping()), timeoutMs).then(answer => answer === 'PONG' ? 'ok' as const : 'down' as const, () => 'down' as const) : 'disabled' as const]);
  return {database, redis};
}
export type BackupRecord = {ok: boolean; at: string; key?: string; bytes?: number; error?: string};
export const readBackupRecord = async (): Promise<BackupRecord | null | undefined> => withRedis(async redis => {
  try {return JSON.parse(await redis.get(KEYS.backup()) || 'null') as BackupRecord | null;} catch {return null;}
});
/** The checks themselves, without sending anything. `worker` is null when Redis could not be asked. */
export async function inspect(now = Date.now()): Promise<Alert[]> {
  const settings = alertSettings(), alerts: Alert[] = [], ready = await readiness();
  if (ready.database === 'down') alerts.push({kind: 'database_down', text: 'The database does not answer.', details: {}});
  if (ready.redis === 'down') alerts.push({kind: 'redis_down', text: 'Redis does not answer: the job queue, caches and rate limits are affected.', details: {}});
  const [requests, jobs] = [await errorCount('request', now), await errorCount('job', now)];
  if (requests >= settings.errors) alerts.push({kind: 'errors', text: requests + ' request errors in the last 5 minutes (threshold ' + settings.errors + ').', details: {count: requests, threshold: settings.errors}});
  if (jobs >= settings.jobs) alerts.push({kind: 'jobs', text: jobs + ' background jobs failed for good in the last 5 minutes (threshold ' + settings.jobs + ').', details: {count: jobs, threshold: settings.jobs}});
  if (ready.redis !== 'ok') return alerts;
  // The heartbeat key lives for 90 s; "missing since" turns that into "missing for more than three minutes".
  const since = await withRedis(async redis => {
    if (workerHeartbeat(await redis.get(KEYS.heartbeat()), now).status === 'ok') {await redis.del(KEYS.workerMissing()); return 0;}
    await redis.set(KEYS.workerMissing(), String(now), 'EX', 7 * 86400, 'NX');
    return Number(await redis.get(KEYS.workerMissing())) || now;
  });
  if (since && now - since > WORKER_GRACE_MS) alerts.push({kind: 'worker_down', text: 'The background worker has not sent a heartbeat for ' + Math.round((now - since) / 60_000) + ' minutes.',
    details: {missingSince: new Date(since).toISOString()}});
  if (process.env.BACKUP_ENABLED === 'true') {
    const record = await readBackupRecord();
    if (record && !record.ok) alerts.push({kind: 'backup_failed', text: 'The last database backup failed: ' + (record.error || 'unknown') + '.', details: {at: record.at, error: record.error ?? null}});
    else if (record !== undefined) {
      // No successful backup yet: the clock starts when the watchdog first sees backups enabled.
      const from = record ? Date.parse(record.at) : await withRedis(async redis => {
        await redis.set(KEYS.backupExpected(), String(now), 'EX', 30 * 86400, 'NX');
        return Number(await redis.get(KEYS.backupExpected())) || now;
      }) ?? now;
      if (now - from > BACKUP_STALE_MS) alerts.push({kind: 'backup_stale', text: 'No successful database backup for ' + Math.round((now - from) / 3600_000) + ' hours.', details: {last: record?.at ?? null}});
    }
  }
  return alerts;
}
/** One watchdog pass: inspect and alert. Safe to call from several processes — the cooldown is shared. */
export async function runWatchdog(deps: AlertDeps = {}) {
  const now = (deps.now ?? Date.now)(), alerts = await inspect(now), sent: AlertKind[] = [];
  for (const alert of alerts) if (await sendAlert(alert, deps)) sent.push(alert.kind);
  return {problems: alerts.map(alert => alert.kind), sent};
}
let timer: NodeJS.Timeout | undefined;
/**
 * The web process's own watchdog (started from instrumentation.ts): the worker cannot report its own death.
 * A Redis lock lets one web instance per minute do the work; nothing starts unless an alert target is configured.
 */
export function startWebWatchdog(everyMs = 60_000) {
  if (timer || !alertsConfigured()) return false;
  timer = setInterval(() => {
    void (async () => {
      const lock = await withRedis(redis => redis.set(KEYS.watchdog(), '1', 'PX', everyMs - 5000, 'NX'));
      if (lock === null) return;
      await runWatchdog();
    })().catch(error => log('warn', 'watchdog_failed', {message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'}));
  }, everyMs);
  timer.unref();
  return true;
}
export const stopWebWatchdog = () => {clearInterval(timer); timer = undefined;};
