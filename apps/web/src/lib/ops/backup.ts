import {spawn} from 'node:child_process';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withRedis} from '../redis';
import {storage, type Storage} from '../storage';
import {s3Settings, s3Storage} from '../storage/s3';
import {KEYS, type BackupRecord} from './alerts';
// Platform-independent fallback for database backups (Railway's own volume backups are the primary mechanism):
// pg_dump in the custom format → the object store under backups/YYYY/MM/DD/ → old dumps pruned. Off unless
// BACKUP_ENABLED=true. The "backups/" prefix is never served by any HTTP route: the media route only answers
// "img/<profile>/<uuid>/<width>.<format>" keys. See docs/operations.md for the restore procedure.
export const BACKUP_PREFIX = 'backups/';
const KEY = /^backups\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9_-]+-\d{8}T\d{6}Z\.dump$/;
const DAY = 86400_000;
const log = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) =>
  (level === 'error' ? console.error : console.log)(JSON.stringify({level, event, ...fields}));
export const retentionDays = () => {
  const value = Number(process.env.BACKUP_RETENTION_DAYS);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 30;
};
export function backupKey(database: string, now: Date) {
  const iso = now.toISOString(), name = database.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'db';
  return BACKUP_PREFIX + iso.slice(0, 4) + '/' + iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + name + '-' + iso.slice(0, 19).replace(/[-:]/g, '') + 'Z.dump';
}
/**
 * libpq settings from DATABASE_URL, passed through the environment: the password never appears in the process list,
 * and Prisma-only parameters (?schema=…, connection_limit, pgbouncer) that pg_dump would reject are dropped.
 */
export function pgEnv(databaseUrl: string): {env: Record<string, string>; database: string} {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('BACKUP_BAD_DATABASE_URL');
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')), sslmode = url.searchParams.get('sslmode');
  if (!database) throw new Error('BACKUP_BAD_DATABASE_URL');
  return {database, env: {PGHOST: decodeURIComponent(url.hostname), PGPORT: url.port || '5432', PGDATABASE: database,
    ...(url.username ? {PGUSER: decodeURIComponent(url.username)} : {}), ...(url.password ? {PGPASSWORD: decodeURIComponent(url.password)} : {}),
    ...(sslmode ? {PGSSLMODE: sslmode} : {}), PGCONNECT_TIMEOUT: '15'}};
}
type Ran = {code: number | null; missing: boolean; stdout: string; stderr: string};
// Output is kept short and anything that looks like a connection string is cut out before it can reach a log.
const scrub = (text: string) => text.replace(/postgres(ql)?:\/\/\S+/gi, '[url]').replace(/password\S*/gi, '[redacted]').trim().slice(-500);
function run(command: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<Ran> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', done = false;
    const finish = (result: Pick<Ran, 'code' | 'missing'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({...result, stdout: stdout.slice(0, 2000), stderr: scrub(stderr)});
    };
    const child = spawn(command, args, {env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    const timer = setTimeout(() => {stderr += '\nTIMEOUT'; child.kill('SIGKILL'); finish({code: null, missing: false});}, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {if (stdout.length < 2000) stdout += chunk.toString('utf8');});
    child.stderr.on('data', (chunk: Buffer) => {stderr = (stderr + chunk.toString('utf8')).slice(-4000);});
    child.on('error', (error: NodeJS.ErrnoException) => finish({code: null, missing: error.code === 'ENOENT'}));
    child.on('close', code => finish({code, missing: false}));
  });
}
const binary = (name: 'pg_dump' | 'pg_restore') => {
  const directory = process.env.PG_BIN_DIR?.trim();
  return directory ? join(directory, name + (process.platform === 'win32' ? '.exe' : '')) : name;
};
/** The pg_dump version line, or null when the binary is not installed (or not runnable). */
export async function pgDumpVersion() {
  const result = await run(binary('pg_dump'), ['--version'], {}, 10_000);
  return result.code === 0 ? result.stdout.trim().slice(0, 100) : null;
}
export type Dump = (file: string, env: Record<string, string>) => Promise<void>;
const pgDump: Dump = async (file, env) => {
  const result = await run(binary('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--file=' + file], env, 60 * 60_000);
  if (result.code !== 0) throw new Error('PG_DUMP_FAILED ' + (result.stderr || 'exit ' + result.code));
  // The archive's table of contents must be readable: a truncated or foreign file fails here, not on the day of a restore.
  const listed = await run(binary('pg_restore'), ['--list', file], {}, 5 * 60_000);
  if (!listed.missing && listed.code !== 0) throw new Error('BACKUP_UNREADABLE ' + listed.stderr);
};
/**
 * Where dumps go. With S3 the bucket may be a separate, private one (BACKUP_S3_BUCKET, same endpoint and
 * credentials). A media bucket that is published through S3_PUBLIC_URL is refused unless BACKUP_PUBLIC_BUCKET_OK=true
 * confirms that its public-read policy covers "img/*" only — a database dump must never be world-readable.
 */
export function backupStorage(): Storage {
  const settings = process.env.MEDIA_STORAGE === 'local' ? null : s3Settings(), bucket = process.env.BACKUP_S3_BUCKET?.trim();
  if (!settings) return storage();
  if (bucket) return s3Storage({...settings, bucket});
  if (process.env.S3_PUBLIC_URL && process.env.BACKUP_PUBLIC_BUCKET_OK !== 'true') throw new Error('BACKUP_BUCKET_IS_PUBLIC');
  return storage();
}
export async function pruneBackups(store: Storage, now: Date, days = retentionDays()) {
  const listed = await store.list(BACKUP_PREFIX, {limit: 5000});
  const old = listed.filter(item => KEY.test(item.key) && now.getTime() - item.modified.getTime() > days * DAY).map(item => item.key);
  if (old.length) await store.deleteObjects(old);
  return {kept: listed.length - old.length, pruned: old.length};
}
const record = (value: BackupRecord) => withRedis(redis => redis.set(KEYS.backup(), JSON.stringify(value), 'EX', 90 * 86400));
export type BackupDeps = {now?: Date; dump?: Dump; store?: Storage; databaseUrl?: string; version?: () => Promise<string | null>};
/**
 * One backup. Every outcome is recorded in Redis for the watchdog (a failure alerts at once, a missing success after
 * 36 hours). A missing pg_dump is recorded as a failure too (with BACKUP_ENABLED=true somebody expects backups to
 * exist) but the run is only skipped; any other failure throws so that the queue retries with backoff.
 */
export async function backupDatabase(deps: BackupDeps = {}) {
  const now = deps.now ?? new Date(), started = Date.now();
  let directory: string | undefined;
  try {
    const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('BACKUP_NO_DATABASE_URL');
    const {env, database} = pgEnv(databaseUrl);
    if (!deps.dump && !await (deps.version ?? pgDumpVersion)()) {
      // Nothing to retry until the image changes: one clear line, a record for the watchdog, and the run is skipped.
      await record({ok: false, at: now.toISOString(), error: 'PG_DUMP_MISSING'});
      log('error', 'backup_skipped', {reason: 'PG_DUMP_MISSING', hint: 'install the PostgreSQL client tools (pg_dump of the server\'s major version or newer) in the worker image, or point PG_BIN_DIR at them'});
      return {ok: false as const, skipped: 'PG_DUMP_MISSING' as const};
    }
    const store = deps.store ?? backupStorage(), key = backupKey(database, now);
    directory = await mkdtemp(join(tmpdir(), 'dance-backup-'));
    const file = join(directory, 'database.dump');
    await (deps.dump ?? pgDump)(file, env);
    const bytes = (await stat(file)).size;
    if (!bytes) throw new Error('BACKUP_EMPTY');
    await store.putFile(key, file, 'application/octet-stream');
    // Pruning only ever follows a successful upload: a broken backup job cannot eat the existing dumps.
    const pruned = await pruneBackups(store, now).catch(error => {
      log('warn', 'backup_prune_failed', {message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'});
      return {kept: null, pruned: 0};
    });
    await record({ok: true, at: now.toISOString(), key, bytes});
    const result = {ok: true as const, driver: store.driver, key, bytes, ms: Date.now() - started, ...pruned};
    log('info', 'backup_completed', result);
    return result;
  } catch (error) {
    const message = scrub(error instanceof Error ? error.message : 'unknown') || 'unknown';
    await record({ok: false, at: now.toISOString(), error: message.slice(0, 200)});
    log('error', 'backup_failed', {message});
    throw new Error(message.slice(0, 300));
  } finally {
    if (directory) await rm(directory, {recursive: true, force: true}).catch(() => undefined);
  }
}
