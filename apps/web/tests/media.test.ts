import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {clearEmbedMemoryCache, fetchOEmbed, parseInstagramUrl, resolveEmbed, type EmbedEntry, type EmbedStore} from '../src/lib/embeds/instagram';
import {MediaError} from '../src/lib/media/errors';
import {TARGETS, baseKey, chatBaseKey, chatPrefix, isBaseKey, parseChatKey, parseRawKey, parseVariantKey, rawKey, variantKey, variantKeys} from '../src/lib/media/keys';
import {processImage} from '../src/lib/media/process';
import {mediaUrl, variants} from '../src/lib/media/url';
import {rateLimit, resetMemoryRateLimits} from '../src/lib/rate-limit';
import {closeRedis} from '../src/lib/redis';
import {readObject, storage} from '../src/lib/storage';
import {signLocalUpload, verifyLocalUpload} from '../src/lib/storage/local';
import {s3Storage} from '../src/lib/storage/s3';
// Hermetic: no Redis, no S3, no Meta, no database. Everything below runs against the in-memory and local-disk fallbacks.
for (const name of ['REDIS_URL', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_PUBLIC_URL', 'INSTAGRAM_OEMBED_URL', 'INSTAGRAM_OEMBED_TOKEN', 'MEDIA_MAX_PIXELS', 'MEDIA_ALLOW_HEIC'])
  delete process.env[name];
process.env.MEDIA_SIGNING_SECRET = 'test-only-signing-secret';
const directory = mkdtempSync(join(tmpdir(), 'dance-media-'));
process.env.MEDIA_LOCAL_DIR = directory;
after(async () => {await rm(directory, {recursive: true, force: true}); await closeRedis();});
const code = (action: () => unknown) => {
  try {action();} catch (error) {return error instanceof MediaError ? error.code : 'OTHER';}
  return 'NO_ERROR';
};
const rejects = async (promise: Promise<unknown>) => promise.then(() => 'NO_ERROR', error => error instanceof MediaError ? error.code : 'OTHER');
const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('Instagram links: posts and reels are normalised, everything else is refused with a precise reason', () => {
  const ok: [string, string][] = [
    ['https://www.instagram.com/p/CxYz_12-ab/', 'https://www.instagram.com/p/CxYz_12-ab/'],
    ['https://instagram.com/p/CxYz_12-ab', 'https://www.instagram.com/p/CxYz_12-ab/'],
    ['  https://www.instagram.com/reel/DAbc123xyz/?igsh=MTIzNDU2&utm_source=ig_web_copy_link#frag ', 'https://www.instagram.com/reel/DAbc123xyz/'],
    ['https://www.instagram.com/reels/DAbc123xyz/', 'https://www.instagram.com/reel/DAbc123xyz/'],
    ['https://www.instagram.com/tv/B_abc12345/', 'https://www.instagram.com/tv/B_abc12345/'],
    ['https://www.instagram.com/some.dancer/p/CxYz_12-ab/?img_index=1', 'https://www.instagram.com/p/CxYz_12-ab/'],
    ['https://WWW.INSTAGRAM.COM/p/CxYz_12-ab/', 'https://www.instagram.com/p/CxYz_12-ab/']
  ];
  for (const [input, permalink] of ok) assert.equal(parseInstagramUrl(input).permalink, permalink, input);
  for (const profile of ['https://www.instagram.com/some.dancer', 'https://instagram.com/some.dancer/', 'https://www.instagram.com/some.dancer/?hl=en',
    'https://www.instagram.com/some.dancer/reels/', 'https://www.instagram.com/'])
    assert.equal(code(() => parseInstagramUrl(profile)), 'EMBED_PROFILE_URL', profile);
  for (const invalid of [
    'http://www.instagram.com/p/CxYz_12-ab/', 'https://m.instagram.com/p/CxYz_12-ab/', 'https://instagram.com.evil.example/p/CxYz_12-ab/',
    'https://evil.example/https://www.instagram.com/p/CxYz_12-ab/', 'https://www.instagram.com@evil.example/p/CxYz_12-ab/',
    'https://user:pass@www.instagram.com/p/CxYz_12-ab/', 'https://www.instagram.com:8443/p/CxYz_12-ab/', 'https://www.instagram.com/p/',
    'https://www.instagram.com/p/CxYz_12-ab/embed/', 'https://www.instagram.com/p/a%2F..%2Fb/', 'https://www.instagram.com/explore/tags/lindyhop/',
    'https://www.instagram.com/stories/some.dancer/123456/', 'https://www.facebook.com/p/CxYz_12-ab/', 'javascript:alert(1)', 'not a url', '',
    'https://www.instagram.com/p/' + 'a'.repeat(600)
  ]) assert.equal(code(() => parseInstagramUrl(invalid)), 'EMBED_INVALID_URL', invalid);
});

const memoryStore = (initial?: EmbedEntry) => {
  const saved: EmbedEntry[] = [];
  const store: EmbedStore = {find: async () => initial ?? null, save: async (_permalink, entry) => {saved.push(entry);}};
  return {store, saved};
};
const answer = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const good = {author_name: 'some.dancer', title: 'Saturday social', thumbnail_url: 'https://scontent.cdninstagram.com/v/t51/1.jpg?sig=abc', html: '<blockquote class="instagram-media"></blockquote>'};
function mockFetch(respond: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const impl = (async (input: RequestInfo | URL) => {const url = new URL(String(input)); calls.push(url); return respond(url);}) as typeof fetch;
  return {impl, calls};
}

test('oEmbed is requested from the fixed Meta host, without a token unless one is configured', async () => {
  const {impl, calls} = mockFetch(() => answer(good));
  process.env.INSTAGRAM_OEMBED_URL = 'https://169.254.169.254/latest/meta-data';
  const first = await fetchOEmbed('https://www.instagram.com/p/AAAAA11111/', impl);
  delete process.env.INSTAGRAM_OEMBED_URL;
  assert.equal(first.ok, true);
  assert.equal(calls[0].origin + calls[0].pathname, 'https://graph.facebook.com/v25.0/instagram_oembed');
  assert.equal(calls[0].searchParams.get('url'), 'https://www.instagram.com/p/AAAAA11111/');
  assert.equal(calls[0].searchParams.has('access_token'), false);
  process.env.INSTAGRAM_OEMBED_TOKEN = 'app|secret';
  await fetchOEmbed('https://www.instagram.com/p/AAAAA11111/', impl);
  delete process.env.INSTAGRAM_OEMBED_TOKEN;
  assert.equal(calls[1].searchParams.get('access_token'), 'app|secret');
});

test('a successful embed is cached: the same post under different links costs one upstream call', async () => {
  clearEmbedMemoryCache();
  const {impl, calls} = mockFetch(() => answer(good));
  const {store, saved} = memoryStore();
  const first = await resolveEmbed('https://www.instagram.com/p/BBBBB22222/?igsh=abc', {fetch: impl, store});
  const second = await resolveEmbed('https://instagram.com/p/BBBBB22222', {fetch: impl, store});
  const burst = await Promise.all([1, 2, 3].map(() => resolveEmbed('https://www.instagram.com/some.dancer/p/BBBBB22222/', {fetch: impl, store})));
  assert.equal(calls.length, 1);
  assert.deepEqual(first, {status: 'ok', permalink: 'https://www.instagram.com/p/BBBBB22222/', author: 'some.dancer', title: 'Saturday social',
    thumbnailUrl: good.thumbnail_url, html: good.html});
  assert.deepEqual(second, first);
  assert.deepEqual(burst[2], first);
  assert.equal(saved.length, 1);
});

test('concurrent requests for an uncached post share one upstream call', async () => {
  clearEmbedMemoryCache();
  const {impl, calls} = mockFetch(async () => {await new Promise(resolve => setTimeout(resolve, 20)); return answer(good);});
  const {store} = memoryStore();
  const results = await Promise.all(Array.from({length: 20}, () => resolveEmbed('https://www.instagram.com/reel/CCCCC33333/', {fetch: impl, store})));
  assert.equal(calls.length, 1);
  assert.ok(results.every(result => result.status === 'ok'));
});

test('a copy stored within the last day is served without calling Meta; an older one is refreshed', async () => {
  clearEmbedMemoryCache();
  const {impl, calls} = mockFetch(() => answer({...good, title: 'Fresh'}));
  const now = Date.now();
  const recent = await resolveEmbed('https://www.instagram.com/p/DDDDD44444/', {fetch: impl,
    store: memoryStore({status: 'ok', meta: {author: 'stored', title: 'Stored'}, fetchedAt: now - 3_600_000}).store});
  assert.equal(calls.length, 0);
  assert.equal(recent.title, 'Stored');
  const old = await resolveEmbed('https://www.instagram.com/p/EEEEE55555/', {fetch: impl,
    store: memoryStore({status: 'ok', meta: {author: 'stored', title: 'Stored'}, fetchedAt: now - 2 * 86_400_000}).store});
  assert.equal(calls.length, 1);
  assert.equal(old.title, 'Fresh');
});

test('upstream failures degrade to a link card and never throw', async () => {
  const failures: [string, () => Response | Promise<Response>][] = [
    ['deleted or private post', () => answer({error: {message: 'not found'}}, 404)],
    ['token required', () => answer({error: {type: 'OAuthException', code: 104}}, 400)],
    ['rate limited', () => answer('', 429)],
    ['Meta outage', () => answer('upstream error', 502)],
    ['network error', () => {throw new TypeError('fetch failed');}],
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['not JSON', () => answer('<html>login</html>')],
    ['oversized answer', () => answer('"' + 'x'.repeat(250_000) + '"')]
  ];
  let index = 0;
  for (const [name, respond] of failures) {
    clearEmbedMemoryCache();
    const {impl, calls} = mockFetch(respond);
    const {store, saved} = memoryStore();
    const url = 'https://www.instagram.com/p/FFFFF6666' + index++ + '/';
    const result = await resolveEmbed(url, {fetch: impl, store});
    assert.deepEqual(result, {status: 'degraded', permalink: url}, name);
    // The failure is remembered briefly, so a broken upstream is not hit on every request.
    await resolveEmbed(url, {fetch: impl, store});
    assert.equal(calls.length, 1, name);
    assert.equal(saved.length, 0, name);
  }
});

test('when Meta is down an older stored copy keeps the card; a removed post drops to a link', async () => {
  const stale: EmbedEntry = {status: 'ok', meta: {author: 'some.dancer', title: 'Old caption'}, html: '<blockquote></blockquote>', fetchedAt: Date.now() - 3 * 86_400_000};
  clearEmbedMemoryCache();
  const down = await resolveEmbed('https://www.instagram.com/p/GGGGG77777/', {fetch: mockFetch(() => answer('', 503)).impl, store: memoryStore(stale).store});
  assert.equal(down.status, 'ok');
  assert.equal(down.title, 'Old caption');
  const gone = await resolveEmbed('https://www.instagram.com/p/HHHHH88888/', {fetch: mockFetch(() => answer('', 404)).impl, store: memoryStore(stale).store});
  assert.deepEqual(gone, {status: 'degraded', permalink: 'https://www.instagram.com/p/HHHHH88888/'});
  // A failing store must not break the request either.
  clearEmbedMemoryCache();
  const broken: EmbedStore = {find: async () => {throw new Error('db down');}, save: async () => {throw new Error('db down');}};
  assert.equal((await resolveEmbed('https://www.instagram.com/p/IIIII99999/', {fetch: mockFetch(() => answer(good)).impl, store: broken})).status, 'ok');
});

test('oEmbed fields are sanitised: thumbnails only from Meta CDNs over https', async () => {
  for (const thumbnail_url of ['http://scontent.cdninstagram.com/a.jpg', 'https://evil.example/a.jpg', 'https://cdninstagram.com.evil.example/a.jpg', 'javascript:alert(1)', 42]) {
    const result = await fetchOEmbed('https://www.instagram.com/p/JJJJJ00000/', mockFetch(() => answer({...good, thumbnail_url, author_name: {x: 1}})).impl);
    assert.ok(result.ok);
    assert.equal(result.meta.thumbnailUrl, undefined);
    assert.equal(result.meta.author, undefined);
  }
  const fine = await fetchOEmbed('https://www.instagram.com/p/JJJJJ00000/', mockFetch(() => answer({...good, thumbnail_url: 'https://scontent-mad1-1.xx.fbcdn.net/a.jpg'})).impl);
  assert.ok(fine.ok && fine.meta.thumbnailUrl === 'https://scontent-mad1-1.xx.fbcdn.net/a.jpg');
});

test('invalid and profile links are rejected before any network or cache work', async () => {
  const {impl, calls} = mockFetch(() => answer(good));
  assert.equal(await rejects(resolveEmbed('https://www.instagram.com/some.dancer/', {fetch: impl, store: memoryStore().store})), 'EMBED_PROFILE_URL');
  assert.equal(await rejects(resolveEmbed('https://example.com/p/CxYz_12-ab/', {fetch: impl, store: memoryStore().store})), 'EMBED_INVALID_URL');
  assert.equal(calls.length, 0);
});

test('local driver: signed upload URLs verify only for the exact key, size, type and time window', () => {
  const key = rawKey('profile1', 'event', 'event1', uuid), now = Date.now();
  const {url} = signLocalUpload(key, {mime: 'image/jpeg', size: 1234}, now);
  assert.ok(url.startsWith('/api/media/local/' + key + '?'));
  const query = () => new URLSearchParams(url.split('?')[1]);
  assert.deepEqual(verifyLocalUpload(key, query(), now), {size: 1234, mime: 'image/jpeg'});
  assert.equal(verifyLocalUpload(rawKey('profile2', 'event', 'event1', uuid), query(), now), null);
  for (const [name, value] of [['size', '99999999'], ['mime', 'text/html'], ['exp', String(Math.floor(now / 1000) + 99999)], ['sig', 'AAAA'], ['sig', '']]) {
    const tampered = query();
    tampered.set(name, value);
    assert.equal(verifyLocalUpload(key, tampered, now), null, name);
  }
  assert.equal(verifyLocalUpload(key, query(), now + 301_000), null);
  assert.equal(verifyLocalUpload(key, new URLSearchParams(), now), null);
});

test('local driver: objects round-trip and keys cannot escape the media directory', async () => {
  const store = storage();
  assert.equal(store.driver, 'local');
  const key = rawKey('profile1', 'avatar', undefined, uuid);
  assert.equal(await store.exists(key), false);
  assert.equal(await readObject(key, 100), null);
  await store.putObject(key, Buffer.from('hello'), 'application/octet-stream');
  assert.equal(await store.exists(key), true);
  assert.equal(String(await readObject(key, 100)), 'hello');
  assert.equal(await readObject(key, 3), 'TOO_LARGE');
  await store.putObject('img/profile1/' + uuid + '/320.webp', Buffer.from('x'), 'image/webp');
  assert.equal((await store.getObject('img/profile1/' + uuid + '/320.webp'))?.contentType, 'image/webp');
  await store.deletePrefix('img/profile1/');
  assert.equal(await store.exists('img/profile1/' + uuid + '/320.webp'), false);
  await store.deleteObjects([key, 'raw/profile1/avatar/_/missing']);
  assert.equal(await store.exists(key), false);
  for (const bad of ['../outside', 'raw/../../outside', '/etc/passwd', 'raw//x', 'raw/.hidden', 'C:\\Windows\\win.ini', 'raw/a b'])
    await assert.rejects(store.putObject(bad, Buffer.from('x'), 'text/plain'), /INVALID_STORAGE_KEY/, bad);
});

test('S3 driver: the presigned PUT signs content type and length (computed offline, no network)', async () => {
  const s3 = s3Storage({endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', bucket: 'dance-media', accessKeyId: 'test', secretAccessKey: 'test-secret', forcePathStyle: true});
  const key = rawKey('profile1', 'post', 'post1', uuid);
  const presigned = await s3.presignUpload(key, {mime: 'image/png', size: 4321});
  const url = new URL(presigned.url);
  assert.equal(url.origin + url.pathname, 'http://127.0.0.1:9000/dance-media/' + key);
  const signed = (url.searchParams.get('X-Amz-SignedHeaders') || '').split(';');
  assert.ok(signed.includes('content-type') && signed.includes('content-length'), signed.join(';'));
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal([...url.searchParams.keys()].some(name => /checksum/i.test(name)), false);
  assert.deepEqual(presigned.headers, {'Content-Type': 'image/png'});
});

test('upload keys bind the uploader and target; variant keys and URLs are derived predictably', () => {
  const key = rawKey('profile1', 'event', 'event1', uuid);
  assert.deepEqual(parseRawKey(key), {profileId: 'profile1', target: 'event', targetId: 'event1', uuid});
  assert.deepEqual(parseRawKey(rawKey('profile1', 'cover', undefined, uuid)), {profileId: 'profile1', target: 'cover', targetId: undefined, uuid});
  // Every upload target must round-trip: a target missing here is refused when the file arrives.
  for (const target of TARGETS) assert.equal(parseRawKey(rawKey('profile1', target, undefined, uuid))?.target, target, target);
  for (const bad of ['raw/profile1/event/event1/not-a-uuid', 'img/profile1/' + uuid, 'raw/profile1/video/x/' + uuid, key + '/extra', '../' + key])
    assert.equal(parseRawKey(bad), null, bad);
  const base = baseKey('profile1', uuid);
  assert.equal(variantKeys(base).length, 6);
  assert.deepEqual(parseVariantKey(base + '/800.avif'), {base, width: 800, format: 'avif'});
  for (const bad of [key, base, base + '/801.webp', base + '/800.svg', base + '/800.webp/x'])
    assert.equal(parseVariantKey(bad), null, bad);
  assert.equal(mediaUrl(base), '/api/media/file/' + base + '/800.webp');
  assert.equal(variants(base, 1000).webp, [320, 800].map(w => '/api/media/file/' + base + '/' + w + '.webp ' + w + 'w').join(', ') + ', /api/media/file/' + base + '/1600.webp 1000w');
  assert.deepEqual(variants(base, 300).widths, [300]);
  assert.deepEqual(variants(base).widths, [320, 800, 1600]);
  process.env.S3_PUBLIC_URL = 'https://cdn.example.test/media/';
  assert.equal(mediaUrl(base, 320, 'avif'), 'https://cdn.example.test/media/' + base + '/320.avif');
  delete process.env.S3_PUBLIC_URL;
});

test('chat attachment keys: bound to conversation and uploader, and invisible to the public file route', () => {
  const raw = rawKey('profile1', 'chat', 'conv1', uuid);
  assert.deepEqual(parseRawKey(raw), {profileId: 'profile1', target: 'chat', targetId: 'conv1', uuid});
  const base = chatBaseKey('conv1', 'profile1', uuid);
  assert.equal(base, 'chat/conv1/profile1/' + uuid);
  assert.ok(base.startsWith(chatPrefix('conv1')));
  assert.deepEqual(parseChatKey(base), {conversationId: 'conv1', profileId: 'profile1', uuid});
  for (const bad of [baseKey('profile1', uuid), 'chat/conv1/' + uuid, base + '/800.webp', 'chat/../img/profile1/' + uuid, 'chat/conv1/profile1/not-a-uuid', raw])
    assert.equal(parseChatKey(bad), null, bad);
  // /api/media/file serves only what isBaseKey and parseVariantKey accept, and neither accepts the chat prefix.
  assert.equal(isBaseKey(base), false);
  for (const key of variantKeys(base)) assert.equal(parseVariantKey(key), null, key);
  assert.equal(parseVariantKey(variantKey(baseKey('profile1', uuid), 800, 'webp'))?.width, 800);
});

test('image processing: re-encodes to WebP and AVIF, applies orientation and strips EXIF/GPS', async () => {
  const input = await sharp({create: {width: 2000, height: 1000, channels: 3, background: {r: 200, g: 120, b: 40}}})
    .withExif({IFD0: {Copyright: 'secret-owner'}, IFD3: {GPSLatitudeRef: 'N', GPSLatitude: '40/1 25/1 0/1'}})
    .withMetadata({orientation: 6}).jpeg().toBuffer();
  const before = await sharp(input).metadata();
  assert.ok(before.exif && before.orientation === 6);
  const result = await processImage(input);
  assert.equal(result.source, 'jpeg');
  // Orientation 6 turns the 2000x1000 frame into a 1000x2000 portrait; it is never enlarged.
  assert.deepEqual([result.width, result.height], [1000, 2000]);
  assert.deepEqual(result.files.map(file => file.width + '.' + file.format), ['320.avif', '320.webp', '800.avif', '800.webp', '1600.avif', '1600.webp']);
  for (const file of result.files) {
    const meta = await sharp(file.body).metadata();
    assert.equal(meta.format === 'heif' ? 'avif' : meta.format, file.format);
    assert.equal(meta.width, Math.min(file.width, 1000));
    assert.equal(meta.exif, undefined);
    assert.ok(!meta.orientation || meta.orientation === 1);
    assert.equal(file.body.includes('secret-owner'), false);
    assert.equal(file.contentType, 'image/' + file.format);
  }
  assert.equal(result.bytes, result.files[5].body.length);
  assert.equal((await processImage(await sharp(input).png().toBuffer())).source, 'png');
  assert.equal((await processImage(result.files[0].body)).source, 'avif');
});

test('image processing: decompression bombs and oversized dimensions are rejected before decoding', async () => {
  // 13000 x 20 px is tiny on disk but exceeds the maximum side.
  const wide = await sharp({create: {width: 13_000, height: 20, channels: 3, background: '#fff'}}).png().toBuffer();
  assert.equal(await rejects(processImage(wide)), 'MEDIA_DIMENSIONS');
  // A few kilobytes of PNG that would decode to 64 megapixels.
  const bomb = await sharp({create: {width: 8000, height: 8000, channels: 3, background: '#000'}}).png({compressionLevel: 9}).toBuffer();
  assert.ok(bomb.length < 200_000, 'bomb is small on disk: ' + bomb.length);
  assert.equal(await rejects(processImage(bomb)), 'MEDIA_DIMENSIONS');
  process.env.MEDIA_MAX_PIXELS = '10000';
  const small = await sharp({create: {width: 200, height: 200, channels: 3, background: '#000'}}).webp().toBuffer();
  assert.equal(await rejects(processImage(small)), 'MEDIA_DIMENSIONS');
  delete process.env.MEDIA_MAX_PIXELS;
  assert.equal((await processImage(small)).width, 200);
});

test('image processing: the real content decides the type, not the declared MIME or extension', async () => {
  const png = await sharp({create: {width: 64, height: 64, channels: 3, background: '#0a0'}}).png().toBuffer();
  const spoofs: [string, Buffer][] = [
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['empty', Buffer.alloc(0)],
    ['SVG with script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')],
    ['GIF', await sharp({create: {width: 8, height: 8, channels: 3, background: '#00f'}}).gif().toBuffer()],
    ['TIFF', await sharp({create: {width: 8, height: 8, channels: 3, background: '#00f'}}).tiff().toBuffer()],
    ['PNG signature followed by a script', Buffer.concat([png.subarray(0, 8), Buffer.from('<script>alert(1)</script>')])],
    ['truncated PNG', png.subarray(0, Math.floor(png.length / 2))],
    ['executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00')]
  ];
  for (const [name, body] of spoofs) assert.equal(await rejects(processImage(body)), 'MEDIA_TYPE', name);
});

test('rate limit: allows up to the limit per window and reports when to retry (in-memory fallback)', async () => {
  resetMemoryRateLimits();
  const options = {limit: 3, windowSec: 60};
  for (let hit = 0; hit < 3; hit++) assert.deepEqual(await rateLimit('test:a', options), {ok: true, retryAfter: 0});
  const blocked = await rateLimit('test:a', options);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
  assert.equal((await rateLimit('test:b', options)).ok, true);
  assert.equal((await rateLimit('test:short', {limit: 1, windowSec: 1})).ok, true);
  assert.equal((await rateLimit('test:short', {limit: 1, windowSec: 1})).ok, false);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await rateLimit('test:short', {limit: 1, windowSec: 1})).ok, true);
});
