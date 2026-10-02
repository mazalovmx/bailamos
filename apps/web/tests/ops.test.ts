import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import {db, slowQueryLine, sqlForLog, type SlowQueryState} from '@dance/db';
import {closeRedis, withRedis} from '../src/lib/redis';
import {storage} from '../src/lib/storage';
import {variantKeys} from '../src/lib/media/keys';
import {purgeDeletedMedia, referencedKeys, sweepOrphans} from '../src/lib/jobs/media';
import {BACKOFF_KEY, BACKOFF_STEP_KEY, refreshEmbeds, resetEmbedRefreshState} from '../src/lib/embeds/refresh';
import {clearEmbedMemoryCache, resolveEmbed} from '../src/lib/embeds/instagram';
import {dbEmbedStore} from '../src/lib/embeds/store';
import {errorCount, inspect, KEYS, readiness, recordError, resetAlertMemory, runWatchdog, sendAlert, setOpsNamespace, WINDOW_MS} from '../src/lib/ops/alerts';
import {backupDatabase, backupKey, backupStorage, pgEnv, pruneBackups} from '../src/lib/ops/backup';
import {jobs, registryProblems} from '../src/worker/registry';
import {GET as readyRoute} from '../src/app/api/health/ready/route';
import {GET as mediaRoute} from '../src/app/api/media/file/[...key]/route';
import {onRequestError} from '../src/instrumentation';
const tag = 'ops' + randomUUID().slice(0, 8), DAY = 86400_000;
const saved = {storage: process.env.MEDIA_STORAGE, dir: process.env.MEDIA_LOCAL_DIR};
let root = '';
const path = (key: string) => join(root, ...key.split('/'));
async function put(key: string, ageDays = 0, body = 'x') {
  await mkdir(join(root, ...key.split('/').slice(0, -1)), {recursive: true});
  await writeFile(path(key), body);
  if (ageDays) {const at = new Date(Date.now() - ageDays * DAY); await utimes(path(key), at, at);}
}
const image = async (profile: string, ageDays: number) => {
  const base = 'img/' + profile + '/' + randomUUID();
  for (const key of variantKeys(base)) await put(key, ageDays);
  return base;
};
const stored = (base: string) => variantKeys(base).filter(key => existsSync(path(key))).length;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ops-test-'));
  process.env.MEDIA_STORAGE = 'local'; process.env.MEDIA_LOCAL_DIR = root;
  setOpsNamespace(tag + ':');
});
after(async () => {
  if (saved.storage === undefined) delete process.env.MEDIA_STORAGE; else process.env.MEDIA_STORAGE = saved.storage;
  if (saved.dir === undefined) delete process.env.MEDIA_LOCAL_DIR; else process.env.MEDIA_LOCAL_DIR = saved.dir;
  await withRedis(async redis => {
    const keys = await redis.keys(tag + ':*');
    if (keys.length) await redis.del(...keys);
    return null;
  });
  setOpsNamespace('');
  await rm(root, {recursive: true, force: true});
  await closeRedis();
  await db.$disconnect();
});
test('registry: the operations jobs are registered with sound schedules', () => {
  assert.deepEqual(registryProblems(), []);
  const byName = new Map(jobs.map(job => [job.name, job]));
  assert.deepEqual(['embeds.refresh', 'media.purge', 'media.orphans', 'ops.watchdog', 'backup.database', 'blog.notifications'].map(name => !!byName.get(name)), [true, true, true, true, true, true]);
  assert.equal(byName.get('blog.notifications')?.everyMs, 60_000);
  assert.equal(byName.get('ops.watchdog')?.everyMs, 60_000);
  assert.equal(byName.get('backup.database')?.cron, '40 2 * * *');
});
test('storage: list() pages through a prefix in key order and putFile() stores a file from disk', async () => {
  const store = storage(), prefix = 'raw/' + tag + '/';
  for (const name of ['b/2', 'a', 'b/1', 'c']) await put(prefix + name);
  await put(prefix + 'half-written.tmp');
  assert.deepEqual((await store.list(prefix)).map(item => item.key.slice(prefix.length)), ['a', 'b/1', 'b/2', 'c']);
  const first = await store.list(prefix, {limit: 2});
  assert.deepEqual(first.map(item => item.key.slice(prefix.length)), ['a', 'b/1']);
  assert.deepEqual((await store.list(prefix, {after: first[1].key})).map(item => item.key.slice(prefix.length)), ['b/2', 'c']);
  assert.ok(first[0].modified instanceof Date && first[0].size === 1);
  assert.deepEqual(await store.list('raw/' + tag + '-nothing/'), []);
  await assert.rejects(store.list('raw/' + tag), /INVALID_STORAGE_KEY/);
  await assert.rejects(store.list('../' + tag + '/'), /INVALID_STORAGE_KEY/);
  const source = join(root, 'source.bin');
  await writeFile(source, 'dump-bytes');
  await store.putFile('backups/' + tag + '/file.dump', source, 'application/octet-stream');
  assert.equal(await readFile(path('backups/' + tag + '/file.dump'), 'utf8'), 'dump-bytes');
});
test('media.purge removes the files of media deleted in the admin panel, once, and leaves referenced keys alone', async () => {
  const gone = await image(tag, 0), shared = await image(tag, 0), ids = [tag + '-m1', tag + '-m2', tag + '-m3', tag + '-m4'];
  const profile = await db.profile.create({data: {type: 'DANCER', handle: tag, name: 'Ops ' + tag, avatarKey: shared}});
  // The rows apps/admin deleteTarget() writes: action TARGET_DELETE, the storage key in data.mediaKey.
  const row = (targetId: string, mediaKey: string | null, targetType = 'MediaItem') =>
    ({actorUserId: 'staff-' + tag, action: 'TARGET_DELETE', targetType, targetId, data: {reason: 'spam', title: 'upload', text: null, authorUserId: null, mediaKey}});
  await db.auditLog.createMany({data: [row(ids[0], gone), row(ids[1], shared), row(ids[2], null, 'Event'), row(ids[3], 'img/../../etc/passwd')]});
  try {
    assert.deepEqual(await purgeDeletedMedia(new Date(), {targetIds: ids}), {driver: 'local', candidates: 3, purged: 1, kept: 2});
    assert.deepEqual([stored(gone), stored(shared)], [0, 6]);
    const markers = await db.auditLog.findMany({where: {action: 'MEDIA_PURGED', targetId: {in: ids}}, orderBy: {targetId: 'asc'}});
    assert.deepEqual(markers.map(marker => [marker.targetId, (marker.data as {result: string}).result, marker.actorUserId]),
      [[ids[0], 'PURGED', null], [ids[1], 'STILL_REFERENCED', null], [ids[3], 'INVALID_KEY', null]]);
    assert.deepEqual(await purgeDeletedMedia(new Date(), {targetIds: ids}), {driver: 'local', candidates: 0, purged: 0, kept: 0}, 'a second run has nothing to do');
    assert.equal(await db.auditLog.count({where: {action: 'MEDIA_PURGED', targetId: {in: ids}}}), 3);
    // Entries older than the window are history, not work.
    await db.auditLog.create({data: {...row(tag + '-old', gone), createdAt: new Date(Date.now() - 40 * DAY)}});
    assert.equal((await purgeDeletedMedia(new Date(), {targetIds: [tag + '-old']})).candidates, 0);
  } finally {
    await db.auditLog.deleteMany({where: {targetId: {startsWith: tag}}});
    await db.profile.delete({where: {id: profile.id}});
  }
});
test('media.orphans removes only old, complete, unreferenced images — with a dry run, a cap and every kind of reference', async () => {
  const prefix = 'img/' + tag + '-o/', owner = tag + '-o';
  const [item, avatar, cover, attachment, fresh, orphanA, orphanB, orphanC] = [await image(owner, 30), await image(owner, 30), await image(owner, 30), await image(owner, 30),
    await image(owner, 2), await image(owner, 30), await image(owner, 30), await image(owner, 30)];
  await put(prefix + 'notes.txt', 30);
  const profile = await db.profile.create({data: {type: 'DANCER', handle: tag + 'o', name: 'Orphans ' + tag, avatarKey: avatar, coverKey: cover}});
  const orphans = [orphanA, orphanB, orphanC].sort(), made: {event?: string; conversation?: string} = {};
  try {
    // Every MediaItem belongs to an event or a post.
    const city = await db.city.findFirstOrThrow({select: {id: true}});
    made.event = (await db.event.create({data: {slug: 'event-' + tag + '-o', title: 'Orphans ' + tag, startsAt: new Date(Date.now() + DAY), timezone: 'UTC', cityId: city.id, status: 'DRAFT',
      media: {create: {kind: 'upload', storageKey: item, uploaderProfileId: profile.id}}}})).id;
    const conversation = await db.conversation.create({data: {kind: 'GROUP', title: tag, messages: {create: {senderProfileId: profile.id, body: '', attachmentKey: attachment}}}});
    made.conversation = conversation.id;
    assert.deepEqual([...await referencedKeys([item, avatar, cover, attachment, orphanA])].sort(), [item, avatar, cover, attachment].sort());
    const options = {prefix, cursor: false};
    assert.deepEqual(await sweepOrphans(new Date(), {...options, dryRun: true}), {driver: 'local', dryRun: true, scanned: 49, images: 8, orphans: 3, deleted: 0, capped: false});
    assert.deepEqual(orphans.map(stored), [6, 6, 6], 'a dry run deletes nothing');
    assert.deepEqual(await sweepOrphans(new Date(), {...options, max: 2}), {driver: 'local', dryRun: false, scanned: 49, images: 8, orphans: 3, deleted: 2, capped: true});
    assert.deepEqual(orphans.map(stored), [0, 0, 6], 'the cap holds');
    assert.deepEqual((await sweepOrphans(new Date(), options)).deleted, 1);
    assert.deepEqual([item, avatar, cover, attachment, fresh].map(stored), [6, 6, 6, 6, 6], 'referenced and recent images stay');
    assert.equal(existsSync(path(prefix + 'notes.txt')), true, 'anything that is not an image variant is not ours to delete');
    assert.deepEqual((await sweepOrphans(new Date(), options)).orphans, 0);
    // The row goes away (a deleted message, a replaced avatar): the files follow on the next sweep.
    await db.message.deleteMany({where: {conversationId: conversation.id}});
    assert.deepEqual([(await sweepOrphans(new Date(), options)).deleted, stored(attachment)], [1, 0]);
    // A full page ends in the middle of an image: that image waits for the next page instead of being judged by half its files.
    assert.deepEqual((await sweepOrphans(new Date(), {...options, scan: 9, dryRun: true})).images, 2);
  } finally {
    if (made.conversation) await db.conversation.delete({where: {id: made.conversation}});
    if (made.event) await db.event.delete({where: {id: made.event}});
    await db.profile.delete({where: {id: profile.id}});
  }
});
test('embeds.refresh: one request per stale post, gone posts keep their card, refusals back off, outages stop the pass', async () => {
  const link = (code: string) => 'https://www.instagram.com/p/' + (tag + code).replace(/[^A-Za-z0-9]/g, '') + '/', now = Date.now(), hours = (count: number) => new Date(now - count * 3600_000);
  const links = {stale: link('stale'), fresh: link('fresh'), never: link('never'), gone: link('gone'), lost: link('lost'), twin: link('twin')};
  const card = {embedHtml: '<blockquote>old</blockquote>', embedMeta: {author: 'old_author', title: 'Old title'}};
  // Every MediaItem belongs to an event or a post.
  const city = await db.city.findFirstOrThrow({select: {id: true}});
  const event = await db.event.create({data: {slug: 'event-' + tag, title: 'Embeds ' + tag, startsAt: new Date(now + 86400_000), timezone: 'UTC', cityId: city.id, status: 'DRAFT'}}), eventId = event.id;
  await db.mediaItem.createMany({data: [
    {eventId, id: tag + '-stale-1', kind: 'instagram', sourceUrl: links.stale, ...card, embedFetched: hours(30)}, {eventId, id: tag + '-stale-2', kind: 'instagram', sourceUrl: links.stale, ...card, embedFetched: hours(30)},
    {eventId, id: tag + '-fresh', kind: 'instagram', sourceUrl: links.fresh, ...card, embedFetched: hours(2)}, {eventId, id: tag + '-never', kind: 'instagram', sourceUrl: links.never},
    {eventId, id: tag + '-gone', kind: 'instagram', sourceUrl: links.gone, ...card, embedFetched: hours(40)}, {eventId, id: tag + '-lost', kind: 'instagram', sourceUrl: links.lost},
    {eventId, id: tag + '-twin-1', kind: 'instagram', sourceUrl: links.twin, embedHtml: '<blockquote>twin</blockquote>', embedMeta: {author: 'twin'}, embedFetched: hours(1)}, {eventId, id: tag + '-twin-2', kind: 'instagram', sourceUrl: links.twin}]});
  const calls: string[] = [];
  let mode: 'ok' | 'refuse' | 'down' = 'ok';
  const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)), post = url.searchParams.get('url') || '';
    calls.push(post);
    if (mode === 'down') throw new TypeError('fetch failed');
    if (mode === 'refuse') return new Response('{}', {status: 429});
    if (post === links.gone || post === links.lost) return new Response('{}', {status: 404});
    return Response.json({author_name: 'new_author', title: 'New title', html: '<blockquote>new</blockquote>', thumbnail_url: 'https://scontent.cdninstagram.com/t.jpg'});
  }) as typeof fetch;
  const rows = async () => new Map((await db.mediaItem.findMany({where: {id: {startsWith: tag}}})).map(row => [row.id.slice(tag.length + 1), row]));
  const deps = {fetch: fetchStub, now: () => now, permalinks: Object.values(links)};
  const clearBackoff = () => withRedis(redis => redis.del(BACKOFF_KEY, BACKOFF_STEP_KEY));
  try {
    await clearBackoff(); resetEmbedRefreshState(); clearEmbedMemoryCache();
    assert.deepEqual(await refreshEmbeds(deps), {candidates: 5, refreshed: 2, copied: 1, gone: 2, failed: 0, stopped: null});
    assert.deepEqual([...calls].sort(), [links.stale, links.never, links.gone, links.lost].sort(), 'one request per post; fresh and copied posts cost none');
    const after = await rows();
    for (const id of ['stale-1', 'stale-2', 'never']) assert.deepEqual([after.get(id)!.embedHtml, after.get(id)!.embedMeta, after.get(id)!.embedFetched?.getTime()],
      ['<blockquote>new</blockquote>', {author: 'new_author', title: 'New title', thumbnailUrl: 'https://scontent.cdninstagram.com/t.jpg'}, now], id);
    assert.deepEqual([after.get('fresh')!.embedHtml, after.get('fresh')!.embedFetched?.getTime()], [card.embedHtml, hours(2).getTime()]);
    assert.deepEqual([after.get('twin-2')!.embedHtml, after.get('twin-2')!.embedFetched?.getTime()], ['<blockquote>twin</blockquote>', hours(1).getTime()]);
    // Gone at the source: the last good card and the link stay, the row is marked and not asked about again today.
    const gone = after.get('gone')!, meta = gone.embedMeta as {author: string; gone: boolean; goneAt: string};
    assert.deepEqual([gone.embedHtml, gone.sourceUrl, meta.author, meta.gone, gone.embedFetched?.getTime()], [card.embedHtml, links.gone, 'old_author', true, now]);
    assert.deepEqual([(await dbEmbedStore.find(links.gone))?.status, (await dbEmbedStore.find(links.lost))?.status], ['ok', 'degraded']);
    assert.equal(await db.mediaItem.count({where: {id: {startsWith: tag}}}), 8, 'user content is never deleted');
    // Pages read the warmed cache (or the stored copy): no upstream request on a page view.
    calls.length = 0;
    const failing = (async () => {calls.push('page'); throw new Error('no upstream in page views');}) as typeof fetch;
    assert.deepEqual([(await resolveEmbed(links.stale, {fetch: failing})).author, (await resolveEmbed(links.gone, {fetch: failing})).author, (await resolveEmbed(links.lost, {fetch: failing})).status],
      ['new_author', 'old_author', 'degraded']);
    assert.deepEqual(calls, []);
    assert.deepEqual(await refreshEmbeds(deps), {candidates: 0, refreshed: 0, copied: 0, gone: 0, failed: 0, stopped: null}, 'nothing is due again');
    // A day later Meta refuses (429): the pass stops at the first refusal and every worker pauses.
    await db.mediaItem.updateMany({where: {id: {startsWith: tag}}, data: {embedFetched: hours(25)}});
    mode = 'refuse';
    assert.deepEqual(await refreshEmbeds(deps), {candidates: 6, refreshed: 0, copied: 0, gone: 0, failed: 1, stopped: 'REFUSED'});
    assert.equal(calls.length, 1);
    assert.equal((await refreshEmbeds(deps)).stopped, 'BACKOFF');
    assert.equal(calls.length, 1, 'no request during the pause');
    if (process.env.REDIS_URL) {
      const ttl = await withRedis(redis => redis.ttl(BACKOFF_KEY));
      assert.ok(ttl !== undefined && ttl > 800 && ttl <= 900, 'first pause is 15 minutes: ' + ttl);
    }
    assert.equal((await rows()).get('stale-1')!.embedHtml, '<blockquote>new</blockquote>', 'the stored card survives');
    // Meta is down: three failures end the pass, nothing is lost.
    await clearBackoff(); resetEmbedRefreshState(); calls.length = 0; mode = 'down';
    assert.deepEqual(await refreshEmbeds(deps), {candidates: 6, refreshed: 0, copied: 0, gone: 0, failed: 3, stopped: 'OUTAGE'});
    assert.equal(calls.length, 3);
    // The hourly budget is global.
    mode = 'ok'; calls.length = 0;
    assert.equal((await refreshEmbeds({...deps, perHour: 0})).stopped, 'BUDGET');
    assert.equal(calls.length, 0);
  } finally {
    await clearBackoff(); resetEmbedRefreshState(); clearEmbedMemoryCache();
    await db.event.delete({where: {id: eventId}});
  }
});
test('slow queries are logged as JSON without values, truncated and rate-limited', () => {
  const state: SlowQueryState = {windowStart: 0, logged: 0, suppressed: 0};
  const sql = 'SELECT "User"."email" FROM "User" WHERE "email" = $1 AND "name" = \'O\'\'Brien secret\' AND "phone" = 34600111222\n  LIMIT $2';
  assert.equal(slowQueryLine({query: sql, duration: 499}, state, 1000, 500), null);
  const line = slowQueryLine({query: sql, duration: 812.4}, state, 1000, 500)!;
  assert.deepEqual(line, {level: 'warn', event: 'slow_query', ms: 812, thresholdMs: 500, sql: 'SELECT "User"."email" FROM "User" WHERE "email" = $1 AND "name" = \'?\' AND "phone" = ? LIMIT $2'});
  assert.ok(!JSON.stringify(line).includes('Brien') && !JSON.stringify(line).includes('34600111222') && !('params' in line));
  assert.equal(sqlForLog('SELECT ' + 'x, '.repeat(400)).length, 301);
  assert.equal(slowQueryLine({query: sql, duration: 9999}, state, 1000, 0), null, 'SLOW_QUERY_MS=0 switches tracing off');
  // Two lines a minute: the rest is counted and reported on the next line.
  const limited: SlowQueryState = {windowStart: 0, logged: 0, suppressed: 0};
  const results = [1000, 1001, 1002, 1003, 1004].map(at => slowQueryLine({query: 'SELECT 1', duration: 600}, limited, at, 500, 2));
  assert.deepEqual(results.map(Boolean), [true, true, false, false, false]);
  assert.deepEqual([slowQueryLine({query: 'SELECT 1', duration: 600}, limited, 70_000, 500, 2)?.suppressed, limited.suppressed], [3, 0]);
});
test('alerts: errors and failed jobs are counted in a 5-minute window; one alert per cooldown; nothing secret leaves', async () => {
  const env = {webhook: process.env.ALERT_WEBHOOK_URL, email: process.env.ALERT_EMAIL, errors: process.env.ALERT_ERRORS_PER_5MIN, backup: process.env.BACKUP_ENABLED};
  const posts: {url: string; body: Record<string, unknown>}[] = [], mails: string[][] = [];
  const deps = {fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {posts.push({url: String(input), body: JSON.parse(String(init?.body))}); return new Response('ok');}) as typeof fetch,
    mail: async (to: string, subject: string, text: string) => {mails.push([to, subject, text]); return true;}};
  const now = Date.now(), lines: string[] = [], log = console.log, error = console.error;
  try {
    delete process.env.ALERT_WEBHOOK_URL; delete process.env.ALERT_EMAIL; delete process.env.BACKUP_ENABLED;
    process.env.ALERT_ERRORS_PER_5MIN = '3';
    resetAlertMemory();
    // A fresh heartbeat in this test's namespace: the worker is alive.
    await withRedis(redis => redis.set(KEYS.heartbeat(), JSON.stringify({at: new Date(now).toISOString()}), 'EX', 90));
    await recordError('request', now - WINDOW_MS - 1000);
    await recordError('request', now - 60_000);
    await recordError('request', now - 1000);
    assert.equal(await errorCount('request', now), 2, 'the error from six minutes ago left the window');
    assert.deepEqual(await inspect(now), []);
    // The request-error hook counts too, and logs the path without the query string.
    console.error = (line: string) => {lines.push(line);};
    const runtime = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = 'nodejs';
    await onRequestError(new Error('boom ' + tag), {path: '/en/invite?token=secret-' + tag, method: 'GET'}, {routePath: '/[locale]/invite'});
    if (runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = runtime;
    console.error = error;
    assert.ok(lines.some(line => line.includes('request_error') && line.includes('/en/invite')) && !lines.join('').includes('secret-' + tag));
    assert.equal(await errorCount('request'), 3);
    assert.deepEqual((await inspect()).map(alert => [alert.kind, alert.details]), [['errors', {count: 3, threshold: 3}]]);
    assert.deepEqual(await runWatchdog(deps), {problems: ['errors'], sent: []}, 'no target configured: nothing is sent');
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/services/T0/B0/s3cr3t-' + tag;
    process.env.ALERT_EMAIL = 'ops-' + tag + '@example.test';
    console.log = (line: string) => {lines.push(line);};
    assert.deepEqual(await runWatchdog(deps), {problems: ['errors'], sent: ['errors']});
    assert.deepEqual(await runWatchdog(deps), {problems: ['errors'], sent: []}, 'one alert per cooldown');
    console.log = log;
    assert.equal(posts.length, 1);
    assert.match(String(posts[0].body.text), /^\[[^\]]+\] 3 request errors in the last 5 minutes \(threshold 3\)\.$/);
    assert.deepEqual([posts[0].body.kind, posts[0].body.details], ['errors', {count: 3, threshold: 3}]);
    assert.deepEqual([mails.length, mails[0][0], mails[0][1]], [1, 'ops-' + tag + '@example.test', 'Alert: errors']);
    assert.ok(!lines.join('').includes('s3cr3t') && !lines.join('').includes('ops-' + tag + '@'), 'neither the webhook URL nor the address is logged');
    // Failed jobs have their own counter and threshold (5).
    for (let index = 0; index < 5; index++) await recordError('job');
    assert.deepEqual((await runWatchdog(deps)).sent, ['jobs']);
    // A webhook that fails does not use up the cooldown.
    await withRedis(redis => redis.del(KEYS.cooldown('jobs')));
    resetAlertMemory();
    delete process.env.ALERT_EMAIL;
    const broken = {fetch: (async () => new Response('no', {status: 500})) as typeof fetch};
    assert.equal(await sendAlert({kind: 'jobs', text: 'x', details: {}}, broken), false);
    assert.equal(await sendAlert({kind: 'jobs', text: 'x', details: {}}, deps), true);
    // Telegram: the chat id from the URL goes into the body next to the text.
    process.env.ALERT_WEBHOOK_URL = 'https://api.telegram.org/bot123:abc/sendMessage?chat_id=-100200';
    await withRedis(redis => redis.del(KEYS.cooldown('jobs')));
    resetAlertMemory();
    await sendAlert({kind: 'jobs', text: 'hello', details: {}}, deps);
    assert.deepEqual(Object.keys(posts.at(-1)!.body).sort(), ['chat_id', 'text']);
    assert.equal(posts.at(-1)!.body.chat_id, '-100200');
  } finally {
    console.log = log; console.error = error;
    for (const [name, value] of [['ALERT_WEBHOOK_URL', env.webhook], ['ALERT_EMAIL', env.email], ['ALERT_ERRORS_PER_5MIN', env.errors], ['BACKUP_ENABLED', env.backup]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
test('watchdog: a worker without a heartbeat for more than 3 minutes and a failed or missing backup raise alerts', async t => {
  if (!process.env.REDIS_URL) {t.skip('REDIS_URL is not set'); return;}
  const env = {backup: process.env.BACKUP_ENABLED, errors: process.env.ALERT_ERRORS_PER_5MIN}, now = Date.now(), minute = 60_000;
  try {
    delete process.env.BACKUP_ENABLED;
    process.env.ALERT_ERRORS_PER_5MIN = '1000';
    await withRedis(redis => redis.del(KEYS.heartbeat(), KEYS.workerMissing(), KEYS.errors('job'), KEYS.errors('request')));
    resetAlertMemory();
    const kinds = async (at: number) => (await inspect(at)).map(alert => alert.kind);
    assert.deepEqual(await kinds(now), [], 'first seen missing: the clock starts');
    assert.deepEqual(await kinds(now + 2 * minute), []);
    assert.deepEqual(await kinds(now + 3 * minute + 1000), ['worker_down']);
    // The heartbeat is back: the alert clears and the clock is reset.
    await withRedis(redis => redis.set(KEYS.heartbeat(), JSON.stringify({at: new Date(now + 4 * minute).toISOString()}), 'EX', 90));
    assert.deepEqual(await kinds(now + 4 * minute), []);
    assert.equal(await withRedis(redis => redis.exists(KEYS.workerMissing())), 0);
    // Backups: silent when disabled; a failure alerts at once; no success for 36 hours alerts too.
    await withRedis(redis => redis.set(KEYS.backup(), JSON.stringify({ok: false, at: new Date(now).toISOString(), error: 'PG_DUMP_MISSING'})));
    assert.deepEqual(await kinds(now + 4 * minute), []);
    process.env.BACKUP_ENABLED = 'true';
    const failed = await inspect(now + 4 * minute);
    assert.deepEqual(failed.map(alert => [alert.kind, alert.details.error]), [['backup_failed', 'PG_DUMP_MISSING']]);
    await withRedis(redis => redis.set(KEYS.backup(), JSON.stringify({ok: true, at: new Date(now - 30 * 3600_000).toISOString(), key: 'backups/x'})));
    assert.deepEqual(await kinds(now + 4 * minute), []);
    await withRedis(redis => redis.set(KEYS.backup(), JSON.stringify({ok: true, at: new Date(now - 40 * 3600_000).toISOString(), key: 'backups/x'})));
    assert.deepEqual(await kinds(now + 4 * minute), ['backup_stale']);
    await withRedis(redis => redis.del(KEYS.backup()));
    assert.deepEqual(await kinds(now + 4 * minute), [], 'never ran yet: the 36 hours start now');
  } finally {
    for (const [name, value] of [['BACKUP_ENABLED', env.backup], ['ALERT_ERRORS_PER_5MIN', env.errors]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
test('GET /api/health/ready: 200 with database and Redis, 503 when one is down, no secrets in the body', async () => {
  const response = await readyRoute(), body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {status: 'ok', database: 'ok', redis: process.env.REDIS_URL ? 'ok' : 'disabled'});
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const url = process.env.REDIS_URL;
  try {
    // Nothing listens on this port.
    process.env.REDIS_URL = 'redis://127.0.0.1:1/0';
    const down = await readyRoute(), text = await down.text();
    assert.equal(down.status, 503);
    assert.deepEqual(JSON.parse(text), {status: 'unavailable', database: 'ok', redis: 'down'});
    assert.ok(!text.includes('127.0.0.1') && !/redis:\/\/|postgres/i.test(text));
    assert.deepEqual(await readiness(), {database: 'ok', redis: 'down'});
  } finally {
    await closeRedis();
    if (url === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = url;
  }
  assert.equal((await readyRoute()).status, 200);
});
test('backup.database: dump → backups/YYYY/MM/DD/, retention, outcome recorded; a missing pg_dump is reported and skipped', async () => {
  const env = {retention: process.env.BACKUP_RETENTION_DAYS, publicUrl: process.env.S3_PUBLIC_URL, bucket: process.env.S3_BUCKET, key: process.env.S3_ACCESS_KEY, secret: process.env.S3_SECRET_KEY,
    ok: process.env.BACKUP_PUBLIC_BUCKET_OK, backupBucket: process.env.BACKUP_S3_BUCKET};
  const now = new Date('2031-03-09T02:40:07.123Z'), real = new Date(), databaseUrl = 'postgresql://dance:p%40ss@db.internal:6543/dance_prod?schema=public&sslmode=require&connection_limit=5';
  const lines: string[] = [], error = console.error, log = console.log;
  try {
    assert.equal(backupKey('dance_prod', now), 'backups/2031/03/09/dance_prod-20310309T024007Z.dump');
    assert.deepEqual(pgEnv(databaseUrl), {database: 'dance_prod', env: {PGHOST: 'db.internal', PGPORT: '6543', PGDATABASE: 'dance_prod', PGUSER: 'dance', PGPASSWORD: 'p@ss', PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15'}});
    assert.throws(() => pgEnv('mysql://x/y'), /BACKUP_BAD_DATABASE_URL/);
    // An old dump, a recent one and a file that is not ours.
    const old = 'backups/2031/01/01/dance_prod-20310101T024000Z.dump', recent = 'backups/2031/03/01/dance_prod-20310301T024000Z.dump', foreign = 'backups/2031/01/01/notes.txt';
    await put(old, 45); await put(recent, 5); await put(foreign, 45);
    let seen: Record<string, string> = {};
    const dump = async (file: string, pg: Record<string, string>) => {seen = pg; await writeFile(file, 'PGDMP' + tag);};
    console.log = (line: string) => {lines.push(line);};
    const result = await backupDatabase({now: real, dump, databaseUrl});
    console.log = log;
    if (!result.ok) throw new Error('the backup was skipped');
    // Left: the recent dump, the new one and two files that are not dumps.
    assert.deepEqual([result.driver, result.bytes, result.pruned, result.kept], ['local', 5 + tag.length, 1, 4]);
    assert.match(result.key, /^backups\/\d{4}\/\d{2}\/\d{2}\/dance_prod-\d{8}T\d{6}Z\.dump$/);
    assert.equal(await readFile(path(result.key), 'utf8'), 'PGDMP' + tag);
    assert.equal(seen.PGPASSWORD, 'p@ss', 'the password travels in the environment, not in the arguments');
    assert.deepEqual([existsSync(path(old)), existsSync(path(recent)), existsSync(path(foreign))], [false, true, true], '30 days of retention; foreign files are not touched');
    assert.ok(lines.some(line => line.includes('backup_completed')) && !lines.join('').includes('p@ss') && !lines.join('').includes('db.internal'));
    if (process.env.REDIS_URL) assert.deepEqual([(JSON.parse(await withRedis(redis => redis.get(KEYS.backup())) || '{}')).ok, (JSON.parse(await withRedis(redis => redis.get(KEYS.backup())) || '{}')).key], [true, result.key]);
    process.env.BACKUP_RETENTION_DAYS = '3';
    assert.deepEqual(await pruneBackups(storage(), real), {kept: 3, pruned: 1});
    // No pg_dump in the image: a clear structured error, a record for the watchdog, no exception.
    console.error = (line: string) => {lines.push(line);};
    assert.deepEqual(await backupDatabase({now: real, databaseUrl, version: async () => null}), {ok: false, skipped: 'PG_DUMP_MISSING'});
    assert.ok(lines.some(line => JSON.parse(line).event === 'backup_skipped' && JSON.parse(line).reason === 'PG_DUMP_MISSING' && JSON.parse(line).level === 'error'));
    if (process.env.REDIS_URL) assert.deepEqual(JSON.parse(await withRedis(redis => redis.get(KEYS.backup())) || '{}').error, 'PG_DUMP_MISSING');
    // A failing dump is a failed job (the queue retries) and its message is scrubbed.
    await assert.rejects(backupDatabase({now: real, databaseUrl, dump: async () => {throw new Error('PG_DUMP_FAILED connection to postgresql://dance:p@ss@db.internal failed');}}),
      (failure: Error) => failure.message.startsWith('PG_DUMP_FAILED') && !failure.message.includes('p@ss'));
    await assert.rejects(backupDatabase({now: real, databaseUrl, dump: async file => {await writeFile(file, '');}}), /BACKUP_EMPTY/);
    console.error = error;
    assert.ok(!lines.join('').includes('p@ss'));
    // A bucket that is published to the world never receives dumps unless it is confirmed to expose img/ only.
    delete process.env.MEDIA_STORAGE;
    Object.assign(process.env, {S3_BUCKET: 'media', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's', S3_PUBLIC_URL: 'https://cdn.example.test'});
    delete process.env.BACKUP_PUBLIC_BUCKET_OK; delete process.env.BACKUP_S3_BUCKET;
    assert.throws(() => backupStorage(), /BACKUP_BUCKET_IS_PUBLIC/);
    process.env.BACKUP_S3_BUCKET = 'private-backups';
    assert.equal(backupStorage().driver, 's3');
  } finally {
    console.error = error; console.log = log;
    process.env.MEDIA_STORAGE = 'local';
    for (const [name, value] of [['BACKUP_RETENTION_DAYS', env.retention], ['S3_PUBLIC_URL', env.publicUrl], ['S3_BUCKET', env.bucket], ['S3_ACCESS_KEY', env.key], ['S3_SECRET_KEY', env.secret],
      ['BACKUP_PUBLIC_BUCKET_OK', env.ok], ['BACKUP_S3_BUCKET', env.backupBucket]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
test('the public media route cannot serve backups (or anything that is not a processed image variant)', async () => {
  const key = 'backups/2031/03/09/dance_prod-20310309T024007Z.dump';
  await put(key);
  const variant = (await image(tag + '-pub', 0)) + '/800.webp';
  const get = (requested: string) => mediaRoute(new Request('http://localhost/api/media/file/' + requested), {params: Promise.resolve({key: requested.split('/')})});
  assert.equal(existsSync(path(key)), true);
  for (const requested of [key, 'backups', 'backups/2031', 'img/../' + key, 'img/' + tag + '/../../' + key, 'raw/' + tag + '/event/_/' + randomUUID(), key + '/800.webp'])
    assert.equal((await get(requested)).status, 404, requested);
  const publicUrl = process.env.S3_PUBLIC_URL;
  delete process.env.S3_PUBLIC_URL;
  try {assert.equal((await get(variant)).status, 200, 'a real image variant is served');}
  finally {if (publicUrl !== undefined) process.env.S3_PUBLIC_URL = publicUrl;}
});
