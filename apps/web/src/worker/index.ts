// Worker process: same codebase and Prisma models as the web app, different entrypoint.
//   tsx src/worker/index.ts                     run the queue worker until SIGINT / SIGTERM
//   tsx src/worker/index.ts --list              print the registered jobs and exit
//   tsx src/worker/index.ts --once <jobName>    run one handler right now, without Redis, and exit (cron-less hosts, tests)
//   tsx src/worker/index.ts --exit-after <sec>  boot, work for that long, then shut down gracefully (smoke test)
// Environment: REDIS_URL (required to run the queue), WORKER_QUEUE (default "dance-jobs"), WORKER_CONCURRENCY (default 2),
// WORKER_JOBS (comma-separated job names to schedule and process; default all).
import './env';
import {hostname} from 'node:os';
import {Queue, Worker, UnrecoverableError, type Job} from 'bullmq';
import Redis from 'ioredis';
import {db} from '@dance/db';
import {closeRedis} from '../lib/redis';
import {recordError} from '../lib/ops/alerts';
import {DEAD_LETTER_KEY, DEAD_LETTER_MAX, HEARTBEAT_EVERY_MS, HEARTBEAT_KEY, HEARTBEAT_TTL_SEC} from './keys';
import {jobs, registryProblems} from './registry';
import type {JobDef} from './types';
const DEFAULT_ATTEMPTS = 3, BACKOFF_MS = 30_000, RUN_LOCK_MS = 15 * 60_000, SHUTDOWN_MS = 30_000;
const log = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) =>
  (level === 'error' ? console.error : console.log)(JSON.stringify({level, event, service: 'worker', ...fields}));
const message = (error: unknown) => error instanceof Error ? error.message : 'unknown';
const schedule = (job: JobDef) => job.cron ? 'cron ' + job.cron + ' UTC' : job.everyMs ? 'every ' + job.everyMs + ' ms' : 'on demand';
async function closeShared() {
  await closeRedis().catch(() => {});
  await db.$disconnect().catch(() => {});
}
async function runOnce(name: string | undefined) {
  const job = jobs.find(item => item.name === name);
  if (!job) {
    log('error', 'job_unknown', {job: name ?? null, known: jobs.map(item => item.name)});
    return 2;
  }
  const started = Date.now();
  log('info', 'job_started', {job: job.name, mode: 'once'});
  try {
    const result = await job.handler({});
    log('info', 'job_completed', {job: job.name, mode: 'once', ms: Date.now() - started, result: result ?? null});
    return 0;
  } catch (error) {
    log('error', 'job_failed', {job: job.name, mode: 'once', ms: Date.now() - started, message: message(error)});
    return 1;
  } finally {await closeShared();}
}
async function serve(exitAfterSec: number | null) {
  const url = process.env.REDIS_URL;
  if (!url) {
    log('error', 'worker_no_redis', {message: 'REDIS_URL is not set'});
    return 1;
  }
  const queueName = process.env.WORKER_QUEUE || 'dance-jobs', concurrency = Math.min(Math.max(Number(process.env.WORKER_CONCURRENCY) || 2, 1), 16);
  const only = (process.env.WORKER_JOBS || '').split(',').map(item => item.trim()).filter(Boolean);
  const active = only.length ? jobs.filter(job => only.includes(job.name)) : jobs, byName = new Map(active.map(job => [job.name, job]));
  // BullMQ blocks on Redis, which requires unlimited retries per request; it reconnects on its own after an outage.
  const connection = {url, maxRetriesPerRequest: null};
  const redis = new Redis(url, {maxRetriesPerRequest: null, retryStrategy: attempt => Math.min(attempt * 500, 15_000)});
  redis.on('error', error => log('warn', 'redis_error', {message: message(error)}));
  const queue = new Queue(queueName, {connection});
  queue.on('error', error => log('warn', 'queue_error', {message: message(error)}));
  await queue.waitUntilReady();
  // Schedules are keyed by job name, so a restart updates them in place instead of adding a second copy;
  // schedules whose job no longer exists in the registry are removed.
  const known = new Set(jobs.map(job => job.name));
  for (const scheduler of await queue.getJobSchedulers(0, -1)) {
    const id = scheduler.id || scheduler.key;
    if (known.has(id) && jobs.find(job => job.name === id && (job.cron || job.everyMs))) continue;
    await queue.removeJobScheduler(id);
    log('info', 'schedule_removed', {job: id});
  }
  for (const job of active) {
    if (!job.cron && !job.everyMs) continue;
    await queue.upsertJobScheduler(job.name, job.cron ? {pattern: job.cron, tz: 'UTC'} : {every: job.everyMs}, {name: job.name, data: {},
      opts: {attempts: job.attempts ?? DEFAULT_ATTEMPTS, backoff: {type: 'exponential', delay: BACKOFF_MS}, removeOnComplete: {count: 100}, removeOnFail: {count: DEAD_LETTER_MAX}}});
    log('info', 'schedule_set', {job: job.name, schedule: schedule(job), attempts: job.attempts ?? DEFAULT_ATTEMPTS});
  }
  const worker = new Worker(queueName, async (job: Job) => {
    const definition = byName.get(job.name);
    // Retrying cannot help: this process does not know the job (old schedule, or excluded through WORKER_JOBS).
    if (!definition) throw new UnrecoverableError('UNKNOWN_JOB ' + job.name);
    // One run of a job at a time across all workers: an every-5-minutes job must not pile up behind a slow run.
    const lock = 'worker:lock:' + queueName + ':' + job.name, token = String(job.id) + ':' + process.pid;
    if (await redis.set(lock, token, 'PX', RUN_LOCK_MS, 'NX') !== 'OK') {
      log('warn', 'job_skipped', {job: job.name, id: job.id, reason: 'ALREADY_RUNNING'});
      return {skipped: 'ALREADY_RUNNING'};
    }
    const started = Date.now();
    log('info', 'job_started', {job: job.name, id: job.id, attempt: job.attemptsMade + 1});
    try {
      const result = await definition.handler((job.data ?? {}) as Record<string, unknown>);
      log('info', 'job_completed', {job: job.name, id: job.id, ms: Date.now() - started, result: result ?? null});
      return result ?? null;
    } finally {
      await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, lock, token).catch(() => {});
    }
  }, {connection, concurrency});
  worker.on('error', error => log('warn', 'worker_error', {message: message(error)}));
  worker.on('failed', (job, error) => {
    const attempts = job?.opts.attempts ?? 1, final = !job || job.attemptsMade >= attempts || error instanceof UnrecoverableError;
    log(final ? 'error' : 'warn', final ? 'job_dead' : 'job_failed', {job: job?.name ?? null, id: job?.id ?? null, attempt: job?.attemptsMade ?? null, attempts, message: message(error)});
    // Counted for the failed-jobs alert (ops.watchdog).
    if (final) void recordError('job').catch(() => {});
    // Dead-letter log: the last failures stay readable after BullMQ trims its own failed set.
    if (final) void redis.multi().lpush(DEAD_LETTER_KEY, JSON.stringify({at: new Date().toISOString(), queue: queueName, job: job?.name ?? null, id: job?.id ?? null,
      attempts: job?.attemptsMade ?? null, message: message(error).slice(0, 500)})).ltrim(DEAD_LETTER_KEY, 0, DEAD_LETTER_MAX - 1).exec().catch(() => {});
  });
  await worker.waitUntilReady();
  const beat = () => redis.set(HEARTBEAT_KEY, JSON.stringify({at: new Date().toISOString(), pid: process.pid, host: hostname(), queue: queueName, jobs: active.map(job => job.name)}),
    'EX', HEARTBEAT_TTL_SEC).catch(error => log('warn', 'heartbeat_failed', {message: message(error)}));
  await beat();
  const heartbeat = setInterval(beat, HEARTBEAT_EVERY_MS);
  log('info', 'worker_ready', {queue: queueName, concurrency, jobs: active.map(job => job.name), pid: process.pid});
  return await new Promise<number>(resolve => {
    let stopping = false;
    const stop = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      log('info', 'worker_stopping', {signal});
      clearInterval(heartbeat);
      // A handler stuck past the deadline must not keep the container from stopping; BullMQ retries a stalled job.
      const force = setTimeout(() => {log('error', 'worker_forced_exit', {afterMs: SHUTDOWN_MS}); process.exit(1);}, SHUTDOWN_MS);
      force.unref();
      try {
        // Waits for running handlers, takes no new jobs.
        await worker.close();
        await queue.close();
        await redis.quit().catch(() => redis.disconnect());
        await closeShared();
        log('info', 'worker_stopped', {signal});
        resolve(0);
      } catch (error) {
        log('error', 'worker_stop_failed', {message: message(error)});
        resolve(1);
      } finally {clearTimeout(force);}
    };
    process.on('SIGINT', () => void stop('SIGINT'));
    process.on('SIGTERM', () => void stop('SIGTERM'));
    if (exitAfterSec !== null) setTimeout(() => void stop('EXIT_AFTER'), exitAfterSec * 1000);
  });
}
async function main(args: string[]) {
  const problems = registryProblems();
  if (problems.length) {
    log('error', 'registry_invalid', {problems});
    return 1;
  }
  if (args.includes('--list')) {
    for (const job of jobs) log('info', 'job', {job: job.name, schedule: schedule(job), attempts: job.attempts ?? DEFAULT_ATTEMPTS});
    return 0;
  }
  if (args.includes('--once')) return runOnce(args[args.indexOf('--once') + 1]);
  const after = args.includes('--exit-after') ? Number(args[args.indexOf('--exit-after') + 1]) : null;
  if (after !== null && !(after >= 0 && after <= 3600)) {
    log('error', 'bad_arguments', {message: '--exit-after needs a number of seconds'});
    return 2;
  }
  return serve(after);
}
main(process.argv.slice(2)).then(code => {process.exitCode = code;}, error => {
  log('error', 'worker_crashed', {message: message(error)});
  process.exitCode = 1;
}).finally(() => {
  // Open handles of a library must not keep a finished run alive.
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
});
