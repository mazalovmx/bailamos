import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import webpush from 'web-push';
import {localizeUrl, renderNotification} from '../src/lib/notifications/render';
import {allowedEndpoint, pushAllowed, pushEnabled, subscriptionSchema} from '../src/lib/notifications/push';
import {cronAccess} from '../src/lib/notifications/cron';
import {notificationMail} from '../src/lib/notifications/email';
import {preferencesSchema, readSchema} from '../src/lib/notifications/center';

const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;

test('renderer: every known type is written in the recipient language', () => {
  const data = {title: 'Friday Social', name: 'Anna', startsAt: '2031-05-02T18:00:00.000Z', timezone: 'Europe/Madrid', place: 'Sala Swing'};
  const en = renderNotification('en', 'EVENT_REMINDER', data), es = renderNotification('es', 'EVENT_REMINDER', data), ru = renderNotification('ru', 'EVENT_REMINDER', data);
  assert.equal(en.title, 'Starting soon: Friday Social');
  assert.equal(es.title, 'Empieza pronto: Friday Social');
  assert.equal(ru.title, 'Скоро начало: Friday Social');
  // 18:00 UTC is 20:00 in Madrid in May: the time is the event's local time, not the server's.
  for (const text of [en, es, ru]) {assert.match(text.body, /20[:.]00|8:00/); assert.ok(text.body.includes('Sala Swing'));}
  assert.equal(renderNotification('en', 'NEW_ATTENDEE', data).body, 'Anna is going to Friday Social.');
  assert.equal(renderNotification('ru', 'NEW_ATTENDEE', data).body, 'Anna идёт на «Friday Social».');
  assert.equal(renderNotification('es', 'CHAT_MESSAGE', {senderName: 'Luis', preview: '¿Vienes hoy?'}).title, 'Nuevo mensaje de Luis');
  assert.equal(renderNotification('es', 'CHAT_MESSAGE', {senderName: 'Luis', preview: '¿Vienes hoy?'}).body, '¿Vienes hoy?');
  assert.equal(renderNotification('en', 'EVENT_INVITE', {title: 'Camp', inviter: 'Marta'}).body, 'Marta invites you to co-organize Camp.');
  assert.equal(renderNotification('en', 'NEW_FOLLOWER', {followerName: 'Kim'}).body, 'Kim now follows you.');
  assert.match(renderNotification('en', 'EVENT_CANCELLED', {title: 'Camp'}).body, /^This event has been cancelled/);
  assert.match(renderNotification('en', 'EVENT_CANCELLED', {title: 'Camp', date: '2031-05-02T18:00:00.000Z', timezone: 'Europe/Madrid'}).body, /^The date .*2031.* has been cancelled\.$/);
  assert.match(renderNotification('en', 'CLAIM_DECIDED', {name: 'Swing School', status: 'APPROVED'}).body, /Swing School was approved/);
  assert.match(renderNotification('en', 'CLAIM_DECIDED', {name: 'Swing School', status: 'REJECTED', reason: 'No proof.'}).body, /was declined\. No proof\.$/);
  assert.equal(renderNotification('en', 'MODERATION', {note: 'Your post was hidden.'}).body, 'Your post was hidden.');
  for (const type of ['EVENT_CANCELLED', 'EVENT_REMINDER', 'EVENT_INVITE', 'NEW_ATTENDEE', 'NEW_FOLLOWER', 'PARTNER_MATCH', 'CHAT_MESSAGE', 'CLAIM_DECIDED', 'MODERATION'])
    for (const locale of ['en', 'es', 'ru']) {
      const text = renderNotification(locale, type, data);
      assert.ok(text.title && !/[{}]/.test(text.title + text.body), type + ' ' + locale);
      assert.notEqual(text.title, renderNotification(locale, 'NOPE', {}).title, type + ' has its own title');
    }
});
test('renderer: unknown types, missing fields and hostile data never throw', () => {
  assert.deepEqual(renderNotification('en', 'SOMETHING_NEW', {a: 1}), {title: 'New notification', body: 'Open to see the details.'});
  assert.equal(renderNotification('ru', 'constructor', {}).title, 'Новое уведомление');
  assert.equal(renderNotification('ru', '__proto__', {}).title, 'Новое уведомление');
  assert.equal(renderNotification('xx', 'UNKNOWN', null).title, 'New notification', 'unknown locale falls back to English');
  for (const data of [null, undefined, 'text', 42, [], [{title: 'x'}], {title: 7, name: {}, startsAt: 'not a date', timezone: 'Mars/Phobos'}]) {
    for (const type of ['EVENT_REMINDER', 'NEW_ATTENDEE', 'CHAT_MESSAGE', 'CLAIM_DECIDED', 'EVENT_CANCELLED', 'MODERATION']) {
      const text = renderNotification('en', type, data);
      assert.ok(text.title.length > 0 && !/[{}]|undefined|null|\[object/.test(text.title + text.body), type + ' ' + JSON.stringify(data) + ' -> ' + JSON.stringify(text));
    }
  }
  assert.equal(renderNotification('en', 'NEW_ATTENDEE', {}).body, 'Someone is going to an event.');
  assert.equal(renderNotification('en', 'EVENT_REMINDER', {title: 'x'.repeat(500)}).title.length < 200, true, 'long values are cut');
  // A valid date in an unknown time zone still renders (in UTC) instead of throwing.
  assert.match(renderNotification('en', 'EVENT_REMINDER', {title: 'T', startsAt: '2031-05-02T18:00:00.000Z', timezone: 'Mars/Phobos'}).body, /18[:.]00|6:00/);
});
test('links open in the reader locale and only ever point at this site', () => {
  assert.equal(localizeUrl('/events/jam', 'ru'), '/ru/events/jam');
  assert.equal(localizeUrl('/en/events/jam?date=2031-01-01', 'es'), '/es/events/jam?date=2031-01-01');
  assert.equal(localizeUrl('/es', 'en'), '/en');
  assert.equal(localizeUrl('/english-class', 'ru'), '/ru/english-class', 'a path that merely starts with a locale code is not a locale prefix');
  assert.equal(localizeUrl('/people/anna', 'zz'), '/en/people/anna');
  for (const url of [null, undefined, '', 'https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'events/jam', '/a b']) assert.equal(localizeUrl(url, 'en'), null, String(url));
});
test('push preferences gate exactly three types; everything else is always pushed', () => {
  const off = {pushReminders: false, pushRsvp: false, pushChat: false};
  assert.equal(pushAllowed('EVENT_REMINDER', off), false);
  assert.equal(pushAllowed('NEW_ATTENDEE', off), false);
  assert.equal(pushAllowed('CHAT_MESSAGE', off), false);
  assert.equal(pushAllowed('EVENT_REMINDER', {...off, pushReminders: true}), true);
  assert.equal(pushAllowed('NEW_ATTENDEE', {...off, pushRsvp: true}), true);
  assert.equal(pushAllowed('CHAT_MESSAGE', {...off, pushChat: true}), true);
  for (const type of ['EVENT_CANCELLED', 'EVENT_INVITE', 'NEW_FOLLOWER', 'PARTNER_MATCH', 'CLAIM_DECIDED', 'MODERATION', 'FUTURE_TYPE']) assert.equal(pushAllowed(type, off), true, type);
  for (const type of ['EVENT_REMINDER', 'NEW_ATTENDEE', 'CHAT_MESSAGE']) {assert.equal(pushAllowed(type, null), true); assert.equal(pushAllowed(type, undefined), true);}
});
test('push subscriptions are accepted only for real push services', () => {
  for (const url of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://db5p.notify.windows.com/w/?token=abc'])
    assert.equal(allowedEndpoint(url), true, url);
  for (const url of ['http://fcm.googleapis.com/fcm/send/abc', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com.evil.example/', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://notify.windows.com.evil.example/x', 'not a url', ''])
    assert.equal(allowedEndpoint(url), false, url);
  const keys = {p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22)};
  assert.equal(subscriptionSchema.safeParse({endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys}).success, true);
  assert.equal(subscriptionSchema.safeParse({endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: {...keys, auth: '<script>'}}).success, false);
  assert.equal(subscriptionSchema.safeParse({endpoint: 'https://fcm.googleapis.com/fcm/send/abc'}).success, false);
});
test('request schemas: read one/many/all, partial preferences, nothing else', () => {
  for (const ok of [{all: true}, {id: 'abc123'}, {ids: ['a', 'b']}]) assert.equal(readSchema.safeParse(ok).success, true, JSON.stringify(ok));
  for (const bad of [{}, {all: false}, {id: ''}, {ids: []}, {id: 'a b'}, {ids: Array.from({length: 101}, (_, i) => 'n' + i)}, {all: true, userId: 'x'}, {id: {not: ''}}])
    assert.equal(readSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(preferencesSchema.safeParse({pushChat: false}).success, true);
  for (const bad of [{}, {pushChat: 'no'}, {userId: 'x', pushChat: true}, {digestSentAt: null}]) assert.equal(preferencesSchema.safeParse(bad).success, false, JSON.stringify(bad));
});
test('cron secret: off when unset, constant-time bearer check when set', async () => {
  const before = process.env.CRON_SECRET;
  const {POST} = await import('../src/app/api/notifications/cron/route');
  const call = (authorization?: string) => POST(new Request(origin + '/api/notifications/cron', {method: 'POST', headers: authorization ? {authorization} : {}}));
  try {
    delete process.env.CRON_SECRET;
    assert.equal(cronAccess('Bearer anything'), 'OFF');
    assert.equal((await call('Bearer anything')).status, 404);
    process.env.CRON_SECRET = '   ';
    assert.equal(cronAccess('Bearer '), 'OFF', 'a blank secret is no secret');
    process.env.CRON_SECRET = 'test-secret-' + randomUUID();
    for (const header of [undefined, null, '', 'Bearer', 'Bearer ', 'Bearer wrong', 'Basic ' + process.env.CRON_SECRET, process.env.CRON_SECRET, 'bearer ' + process.env.CRON_SECRET,
      'Bearer ' + process.env.CRON_SECRET + 'x', 'Bearer ' + process.env.CRON_SECRET.slice(0, -1)]) assert.equal(cronAccess(header), 'DENIED', String(header));
    assert.equal(cronAccess('Bearer ' + process.env.CRON_SECRET), 'OK');
    assert.equal((await call()).status, 401);
    assert.equal((await call('Bearer wrong')).status, 401);
    const source = readFileSync(new URL('../src/lib/notifications/cron.ts', import.meta.url), 'utf8');
    assert.ok(source.includes('timingSafeEqual') && !/given\s*===\s*secret/.test(source));
  } finally {if (before === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = before;}
});
test('email templates: localized, escaped, no remote content and no tracking', () => {
  const mail = notificationMail('ru', 'EVENT_REMINDER', {title: '<b>Jam</b> & "friends"', startsAt: '2031-05-02T18:00:00.000Z', timezone: 'Europe/Madrid'}, '/events/jam');
  assert.equal(mail.subject, 'Скоро начало: <b>Jam</b> & "friends"');
  assert.ok(mail.text.includes(origin + '/ru/events/jam') && mail.text.includes(origin + '/ru/settings'));
  assert.ok(!mail.html.includes('<b>Jam</b>') && mail.html.includes('&#60;b&#62;Jam'), 'user text is escaped in HTML');
  assert.ok(!/<img|<script|<link|<iframe|url\(|@import|<form/i.test(mail.html), 'no images, scripts or remote resources');
  const links = [...mail.html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(links.length >= 2 && links.every(link => link.startsWith(origin + '/ru/')), 'every link is a direct link to this site: ' + links.join(' '));
  assert.ok(!/utm_|track|pixel|click\./i.test(mail.html + mail.text));
  assert.equal(notificationMail('es', 'EVENT_CANCELLED', {title: 'Jam'}, null).text.includes('http' + '://evil'), false);
  assert.ok(notificationMail('en', 'EVENT_INVITE', {title: 'Jam', inviter: 'Ann'}, 'https://evil.example/x').html.includes('evil.example') === false, 'foreign links are dropped');
  for (const type of ['EVENT_CANCELLED', 'EVENT_INVITE', 'EVENT_REMINDER', 'CLAIM_DECIDED']) for (const locale of ['en', 'es', 'ru']) {
    const parts = notificationMail(locale, type, {title: 'Jam', name: 'Ann'}, '/events/jam');
    assert.ok(parts.subject && parts.text.length > 40 && parts.html.startsWith('<!doctype html><html lang="' + locale + '"'), type + ' ' + locale);
  }
});

// ---------- Service worker rules ----------
function workerRules() {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const self: Record<string, unknown> = {location: {origin: 'https://dance.example'}, addEventListener() {}};
  vm.runInNewContext(source, {self, URL, Date, Promise, Number, String, Object, Math, JSON, RegExp, Set});
  return {source, rules: self.swRules as {
    cacheRule(request: {method: string; url: string; mode?: string; destination?: string}): string;
    storable(rule: string, response: Record<string, unknown>): boolean;
    wipesPages(method: string, path: string): boolean; safePath(value: unknown): string; localeOf(path: string): string; VERSION: string}};
}
test('service worker: only the agenda, events, city agendas and the calendar are kept for offline', () => {
  const {rules} = workerRules(), site = 'https://dance.example';
  const nav = (path: string, method = 'GET') => rules.cacheRule({method, url: site + path, mode: 'navigate', destination: 'document'});
  for (const path of ['/en/events', '/ru/events?city=madrid&style=lindy-hop', '/es/events/friday-social', '/en/cities/madrid', '/ru/calendar', '/en/calendar?view=week', '/en/events/'])
    assert.equal(nav(path), 'page', path);
  // Everything else is network only (with the offline screen as fallback) and is never written to a cache.
  for (const path of ['/', '/en', '/en/login', '/en/register', '/en/forgot-password', '/en/reset-password?token=abc', '/en/settings', '/ru/profile', '/en/my-events', '/en/messages', '/en/messages/abc',
    '/en/chat/room', '/en/notifications', '/en/onboarding', '/en/invites/tok', '/en/events/new', '/en/events/friday-social/edit', '/en/events/friday-social/attendees', '/en/people/anna',
    '/en/map', '/en/cities', '/en/venues/x', '/en/admin', '/admin', '/admin/reports', '/de/events', '/events', '/en/offline']) {
    assert.equal(nav(path), 'navigate', path);
    assert.equal(rules.storable(nav(path), {status: 200, type: 'basic', redirected: false, contentType: 'text/html', cacheControl: 'public, max-age=60'}), false, path);
  }
  assert.equal(nav('/en/events', 'POST'), 'none');
  assert.equal(rules.cacheRule({method: 'GET', url: 'https://other.example/en/events', mode: 'navigate'}), 'none', 'other origins are not touched');
  assert.equal(rules.cacheRule({method: 'GET', url: 'not a url', mode: 'navigate'}), 'none');
  // App Router data requests for the same pages are not navigations and are left alone.
  assert.equal(rules.cacheRule({method: 'GET', url: site + '/en/events?_rsc=abc', mode: 'cors', destination: ''}), 'none');
});
test('service worker: /api/ is never cached or even intercepted, whatever the request looks like', () => {
  const {rules} = workerRules(), site = 'https://dance.example';
  for (const path of ['/api/events', '/api/events/abc/rsvp', '/api/auth/get-session', '/api/auth/callback/google?code=x', '/api/notifications', '/api/notifications/unread-count', '/api/push/key',
    '/api/account/export', '/api/media/file/photo.jpg', '/api/calendar/feed.ics', '/api', '/api/_next/static/x.js', '/api/images/x.png'])
    for (const method of ['GET', 'POST', 'PUT', 'DELETE'])
      for (const [mode, destination] of [['navigate', 'document'], ['cors', ''], ['no-cors', 'image'], ['same-origin', 'script']]) {
        const rule = rules.cacheRule({method, url: site + path, mode, destination});
        assert.equal(rule, 'none', method + ' ' + path + ' ' + mode);
        assert.equal(rules.storable(rule, {status: 200, type: 'basic', redirected: false, contentType: 'text/html', cacheControl: 'public'}), false);
      }
  // Private screens requested as sub-resources are not cached either.
  for (const path of ['/en/settings', '/en/messages/abc', '/en/login', '/en/notifications', '/en/profile'])
    assert.equal(rules.cacheRule({method: 'GET', url: site + path, mode: 'cors', destination: ''}), 'none', path);
});
test('service worker: static files and images are stale-while-revalidate; responses with Set-Cookie or private are refused', () => {
  const {rules, source} = workerRules(), site = 'https://dance.example';
  assert.equal(rules.cacheRule({method: 'GET', url: site + '/_next/static/chunks/main-abc.js', mode: 'no-cors', destination: 'script'}), 'static');
  assert.equal(rules.cacheRule({method: 'GET', url: site + '/_next/static/css/app.css', mode: 'no-cors', destination: 'style'}), 'static');
  for (const path of ['/images/hero.jpg', '/icons/icon-192.png', '/_next/image?url=%2Fimages%2Fhero.jpg&w=640&q=75', '/icon.svg'])
    assert.equal(rules.cacheRule({method: 'GET', url: site + path, mode: 'no-cors', destination: 'image'}), 'image', path);
  assert.equal(rules.cacheRule({method: 'GET', url: 'https://cdn.example/photo.jpg', mode: 'no-cors', destination: 'image'}), 'none');
  assert.equal(rules.cacheRule({method: 'GET', url: site + '/sw.js', mode: 'same-origin', destination: 'serviceworker'}), 'none');
  assert.equal(rules.cacheRule({method: 'GET', url: site + '/manifest.webmanifest', mode: 'cors', destination: 'manifest'}), 'none');
  const good = {status: 200, type: 'basic', redirected: false, setCookie: false, contentType: 'text/html; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable'};
  for (const rule of ['page', 'static', 'image']) {
    assert.equal(rules.storable(rule, good), true, rule);
    assert.equal(rules.storable(rule, {...good, setCookie: true}), false, rule + ' with Set-Cookie');
    assert.equal(rules.storable(rule, {...good, status: 404}), false);
    assert.equal(rules.storable(rule, {...good, status: 206}), false);
    assert.equal(rules.storable(rule, {...good, type: 'opaque', status: 0}), false);
    assert.equal(rules.storable(rule, {...good, type: 'cors'}), false);
    assert.equal(rules.storable(rule, {...good, redirected: true}), false, 'a redirect (for example to the sign-in page) is never stored');
  }
  for (const rule of ['static', 'image']) for (const cacheControl of ['private', 'private, max-age=60', 'no-store', 'max-age=0, No-Store', 'PRIVATE'])
    assert.equal(rules.storable(rule, {...good, cacheControl}), false, rule + ' ' + cacheControl);
  assert.equal(rules.storable('page', {...good, contentType: 'application/json'}), false);
  for (const rule of ['none', 'navigate', 'anything']) assert.equal(rules.storable(rule, good), false, rule);
  // Stored pages are fetched without cookies, so they are the public rendering; the copy is the only cache.put for pages.
  assert.match(source, /async function remember\(href\)[\s\S]{0,400}credentials: 'omit'/);
  assert.equal((source.match(/caches\.open\(CACHES\.pages\)/g) || []).length, 2, 'pages cache is opened only by remember() and savedPage()');
  assert.ok(!/importScripts|workbox/i.test(source));
});
test('service worker: sign-in and sign-out wipe saved pages; push links stay on this site; old versions are removed', () => {
  const {rules, source} = workerRules();
  assert.equal(rules.wipesPages('POST', '/api/auth/sign-out'), true);
  assert.equal(rules.wipesPages('POST', '/api/auth/sign-in/email'), true);
  assert.equal(rules.wipesPages('DELETE', '/api/account'), true);
  assert.equal(rules.wipesPages('GET', '/api/auth/get-session'), false);
  assert.equal(rules.wipesPages('POST', '/api/events'), false);
  assert.equal(rules.safePath('/ru/events/jam?date=1'), '/ru/events/jam?date=1');
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined, 7, {}]) assert.equal(rules.safePath(value), '/', String(value));
  assert.equal(rules.localeOf('/ru/events'), 'ru'); assert.equal(rules.localeOf('/es'), 'es'); assert.equal(rules.localeOf('/english'), 'en'); assert.equal(rules.localeOf('/'), 'en');
  assert.match(rules.VERSION, /^v\d+$/);
  for (const listener of ['install', 'activate', 'fetch', 'message', 'push', 'notificationclick']) assert.ok(source.includes("addEventListener('" + listener + "'"), listener);
  assert.ok(source.includes("data.type === 'SIGNED_OUT'") && source.includes("name.startsWith('dc-') && !current.includes(name)") && source.includes('trim(CACHES.pages, LIMITS.pages)'));
});

// ---------- Database ----------
test('database: reminder window, idempotency, concurrent claim, preference gating and dead subscriptions', {timeout: 120000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const {sendEventReminders} = await import('../src/lib/notifications/reminders');
  const {setPushSender, sendPush} = await import('../src/lib/notifications/push');
  const {sendNotificationEmail} = await import('../src/lib/notifications/email');
  const {notify} = await import('../src/lib/notify');
  const tag = randomUUID().slice(0, 8), saved = {pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT};
  // A clock far in the future keeps the run away from real events in a shared development database.
  const now = new Date(Date.UTC(2090 + Math.floor(Math.random() * 400), 5, 15, 12, 0, 0)), at = (minutes: number) => new Date(now.getTime() + minutes * 60000);
  const sent: {endpoint: string; payload: {title: string; body: string; url: string; type: string; tag: string}; options: {TTL?: number; vapidDetails?: {subject: string}}}[] = [];
  const city = await db.city.findFirst();
  if (!city) {t.skip('No city in the database (run the seed)'); return;}
  const userIds: string[] = [], eventIds: string[] = [];
  const person = async (name: string, locale: string, extra: Record<string, unknown> = {}) => {
    const id = 'note-' + name + '-' + tag;
    await db.user.create({data: {id, name, email: id + '@example.test', emailVerified: true, ageConfirmed: true, locale, ...extra}});
    userIds.push(id);
    const profile = await db.profile.create({data: {userId: id, type: 'DANCER', handle: ('n-' + name + '-' + tag).slice(0, 30), name}});
    return {id, profileId: profile.id};
  };
  const subscribe = (userId: string, name: string) => db.pushSubscription.create({data: {userId, endpoint: 'https://fcm.googleapis.com/fcm/send/' + name + '-' + tag, p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22)}});
  const event = async (name: string, data: Record<string, unknown>, minutes: number[], cancelled: number[] = []) => {
    const created = await db.event.create({data: {slug: 'note-' + name + '-' + tag, title: 'Reminder ' + name, startsAt: at(minutes[0]), timezone: 'Europe/Madrid', cityId: city.id, status: 'PUBLISHED', ...data,
      occurrences: {create: minutes.map(m => ({startsAt: at(m), cancelled: cancelled.includes(m)}))}} as never, include: {occurrences: true}});
    eventIds.push(created.id);
    return created;
  };
  try {
    const keys = webpush.generateVAPIDKeys();
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
    assert.equal(pushEnabled(), false);
    setPushSender(async target => {sent.push({endpoint: target.endpoint, payload: {} as never, options: {}});});
    const [anna, boris, carla, dmitri, elena, banned] = await Promise.all([person('anna', 'ru'), person('boris', 'es'), person('carla', 'en'), person('dmitri', 'en'), person('elena', 'en'),
      person('banned', 'en', {bannedAt: new Date()})]);
    const [alive, dead] = await Promise.all([subscribe(anna.id, 'alive'), subscribe(anna.id, 'dead'), subscribe(boris.id, 'boris'), subscribe(dmitri.id, 'dmitri'), subscribe(banned.id, 'banned')]);
    await db.notificationPreference.create({data: {userId: boris.id, pushReminders: false, emailEvents: false}});
    // Without VAPID keys the feature is silently off.
    assert.deepEqual(await sendPush(anna.id, 'EVENT_REMINDER', {title: 'x'}, '/events/x'), {sent: 0, removed: 0, failed: 0});
    assert.equal(sent.length, 0);
    process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = 'mailto:test@example.test';
    setPushSender(async (target, payload, options) => {
      sent.push({endpoint: target.endpoint, payload: JSON.parse(payload), options});
      if (target.endpoint === dead.endpoint) throw Object.assign(new Error('gone'), {statusCode: 410});
    });
    // minutes from "now": 60 and 124 are inside the window (2 h + one 5-minute interval), the rest are not.
    const main = await event('main', {}, [60, 124, 126, 300, -10, 90], [90]);
    const draft = await event('draft', {status: 'DRAFT'}, [60]);
    const cancelledEvent = await event('cancelled', {status: 'CANCELLED'}, [60]);
    const hidden = await event('hidden', {hiddenAt: new Date()}, [60]);
    const empty = await event('empty', {}, [60]);
    for (const [who, status] of [[anna, 'GOING'], [boris, 'GOING'], [carla, 'GOING'], [banned, 'GOING'], [elena, 'INTERESTED']] as const)
      await db.rsvp.create({data: {eventId: main.id, profileId: who.profileId, status}});
    for (const other of [draft, cancelledEvent, hidden]) await db.rsvp.create({data: {eventId: other.id, profileId: anna.profileId, status: 'GOING'}});
    const reminders = (userId: string) => db.notification.findMany({where: {userId, type: 'EVENT_REMINDER'}});

    const first = await sendEventReminders(now);
    // main@60, main@124 and empty@60 are claimed; drafts, cancelled, hidden, past and later dates are not.
    assert.equal(first.occurrences, 3);
    assert.equal(first.notified, 6, 'three going people for each of the two main dates');
    const claimed = await db.eventOccurrence.findMany({where: {eventId: {in: eventIds}, reminderSentAt: {not: null}}, select: {eventId: true, startsAt: true}});
    assert.deepEqual(claimed.map(o => (o.startsAt.getTime() - now.getTime()) / 60000).sort((a, b) => a - b), [60, 60, 124]);
    assert.ok(claimed.every(o => o.eventId === main.id || o.eventId === empty.id));
    for (const who of [anna, boris, carla]) assert.equal((await reminders(who.id)).length, 2, who.id);
    for (const who of [elena, banned, dmitri]) assert.equal((await reminders(who.id)).length, 0, who.id + ' is not going, banned or unrelated');
    const stored = (await reminders(anna.id))[0];
    assert.equal(stored.url, '/events/' + main.slug);
    assert.equal((stored.data as {title: string}).title, 'Reminder main');
    assert.equal(stored.readAt, null);

    // Push: Anna (ru, two devices, one of them dead) is pushed; Boris switched reminders off; Carla has no device; the banned user gets nothing.
    assert.deepEqual([...new Set(sent.map(s => s.endpoint))].sort(), [alive.endpoint, dead.endpoint].sort());
    const push = sent.find(s => s.endpoint === alive.endpoint)!;
    assert.equal(push.payload.title, 'Скоро начало: Reminder main', 'payload is written in the recipient language');
    assert.match(push.payload.body, /^Начало в /);
    assert.equal(push.payload.url, '/ru/events/' + main.slug);
    assert.equal(push.payload.type, 'EVENT_REMINDER');
    assert.equal(push.options.TTL, 7200);
    assert.equal(push.options.vapidDetails?.subject, 'mailto:test@example.test');
    assert.equal(await db.pushSubscription.count({where: {id: dead.id}}), 0, 'a 410 removes the subscription');
    assert.equal(await db.pushSubscription.count({where: {id: alive.id}}), 1);
    assert.equal(await db.pushSubscription.count({where: {userId: boris.id}}), 1, 'a muted preference keeps the device');
    // Email is the fallback for going people without a device: Carla only (Anna has push, Boris switched event emails off).
    const mailUp = await fetch('http://' + (process.env.SMTP_HOST || '127.0.0.1') + ':8025/api/v1/messages?limit=1').then(r => r.ok, () => false);
    if (mailUp) assert.equal(first.mailed, 2, 'one email per main date for Carla');

    // Idempotent: nothing is claimed or sent twice.
    const pushes = sent.length;
    assert.deepEqual(await sendEventReminders(now), {occurrences: 0, notified: 0, mailed: 0});
    assert.equal(sent.length, pushes);
    for (const who of [anna, boris, carla]) assert.equal((await reminders(who.id)).length, 2);

    // Five minutes later the 126-minute date has entered the window; five concurrent workers claim it exactly once.
    const runs = await Promise.all(Array.from({length: 5}, () => sendEventReminders(at(5))));
    assert.equal(runs.reduce((sum, run) => sum + run.occurrences, 0), 1);
    assert.equal(runs.reduce((sum, run) => sum + run.notified, 0), 3);
    for (const who of [anna, boris, carla]) assert.equal((await reminders(who.id)).length, 3, who.id);
    assert.equal(sent.filter(s => s.endpoint === alive.endpoint).length, 3);
    assert.equal(sent.filter(s => s.endpoint === dead.endpoint).length, 1, 'the dead device is never tried again');
    // The cancelled date and the one that already started stay untouched for good.
    assert.equal(await db.eventOccurrence.count({where: {eventId: main.id, reminderSentAt: null}}), 3);

    // notify() reaches push through the registered delivery for other types as well, honouring each switch.
    sent.length = 0;
    await notify([boris.id], 'NEW_ATTENDEE', {title: 'Jam', name: 'Zoe'}, '/en/events/jam');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.title, 'Nuevo asistente');
    assert.equal(sent[0].payload.url, '/es/events/jam', 'a stored locale prefix is replaced by the recipient language');
    await db.notificationPreference.update({where: {userId: boris.id}, data: {pushRsvp: false, pushChat: false}});
    await notify([boris.id], 'NEW_ATTENDEE', {title: 'Jam', name: 'Zoe'}, '/en/events/jam');
    await notify([boris.id], 'CHAT_MESSAGE', {senderName: 'Zoe'}, '/messages/1');
    assert.equal(sent.length, 1, 'muted types are stored in the centre but not pushed');
    assert.equal(await db.notification.count({where: {userId: boris.id, type: {in: ['NEW_ATTENDEE', 'CHAT_MESSAGE']}}}), 3);
    await notify([boris.id], 'EVENT_CANCELLED', {title: 'Jam'}, undefined);
    assert.equal(sent.length, 2, 'types without a switch are always pushed');
    assert.equal(sent[1].payload.url, '/es/notifications');
    await notify([banned.id], 'EVENT_CANCELLED', {title: 'Jam'});
    assert.equal(sent.length, 2, 'banned accounts are not pushed');
    // 404 is treated like 410; other failures keep the subscription.
    setPushSender(async () => {throw Object.assign(new Error('not found'), {statusCode: 404});});
    assert.deepEqual(await sendPush(dmitri.id, 'MODERATION', {note: 'x'}), {sent: 0, removed: 1, failed: 0});
    assert.equal(await db.pushSubscription.count({where: {userId: dmitri.id}}), 0);
    const quiet = console.error; console.error = () => undefined;
    try {
      setPushSender(async () => {throw Object.assign(new Error('busy'), {statusCode: 503});});
      assert.deepEqual(await sendPush(anna.id, 'MODERATION', {note: 'x'}), {sent: 0, removed: 0, failed: 1});
    } finally {console.error = quiet;}
    assert.equal(await db.pushSubscription.count({where: {userId: anna.id}}), 1);

    // Event emails obey emailEvents; a claim decision is always sent; banned accounts get nothing.
    assert.equal(await sendNotificationEmail(boris.id, 'EVENT_CANCELLED', {title: 'Jam'}, '/events/jam'), false);
    assert.equal(await sendNotificationEmail(banned.id, 'EVENT_CANCELLED', {title: 'Jam'}), false);
    assert.equal(await sendNotificationEmail('missing-' + tag, 'EVENT_CANCELLED', {title: 'Jam'}), false);
    if (mailUp) {
      assert.equal(await sendNotificationEmail(boris.id, 'CLAIM_DECIDED', {name: 'Swing School', status: 'APPROVED'}, '/people/swing-school'), true);
      assert.equal(await sendNotificationEmail(carla.id, 'EVENT_INVITE', {title: 'Jam', inviter: 'Ann'}, '/invites/abc'), true);
    }
  } finally {
    setPushSender(null);
    for (const [name, value] of [['VAPID_PUBLIC_KEY', saved.pub], ['VAPID_PRIVATE_KEY', saved.priv], ['VAPID_SUBJECT', saved.subject]] as const)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await db.event.deleteMany({where: {id: {in: eventIds}}});
    await db.user.deleteMany({where: {id: {in: userIds}}});
    await fetch('http://' + (process.env.SMTP_HOST || '127.0.0.1') + ':8025/api/v1/search?query=' + encodeURIComponent('to:' + tag + '@example.test'), {method: 'DELETE'}).catch(() => undefined);
  }
});
test('database: notification centre, preferences and push subscription API through the route handlers', {timeout: 120000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const {auth} = await import('../src/lib/auth');
  const list = await import('../src/app/api/notifications/route');
  const read = await import('../src/app/api/notifications/read/route');
  const count = await import('../src/app/api/notifications/unread-count/route');
  const prefs = await import('../src/app/api/notifications/preferences/route');
  const key = await import('../src/app/api/push/key/route');
  const subs = await import('../src/app/api/push/subscriptions/route');
  const tag = randomUUID().slice(0, 8), password = 'Test-only-Strong-' + randomUUID(), saved = {pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY};
  const address = () => '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250));
  const emails = ['one', 'two'].map(name => 'note-api-' + name + '-' + tag + '@example.test');
  try {
    const cookies: string[] = [], ids: string[] = [];
    for (const email of emails) {
      await auth.api.signUpEmail({headers: new Headers({origin, 'x-forwarded-for': address()}), body: {name: 'Notify test', email, password, ageConfirmed: true, locale: 'es'} as never});
      const user = await db.user.update({where: {email}, data: {emailVerified: true}});
      const signIn = await auth.api.signInEmail({headers: new Headers({origin, 'x-forwarded-for': address()}), body: {email, password}, returnHeaders: true});
      cookies.push(signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')); ids.push(user.id);
    }
    const [me, other] = ids;
    const request = (path: string, options: {method?: string; body?: unknown; cookie?: string | null; origin?: string | null} = {}) => {
      const headers = new Headers({'x-forwarded-for': address()});
      if (options.cookie !== null) headers.set('cookie', options.cookie ?? cookies[0]);
      if (options.method && options.origin !== null) headers.set('origin', options.origin ?? origin);
      if (options.body !== undefined) headers.set('content-type', 'application/json');
      return new Request(origin + path, {method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)});
    };
    // 25 notifications of mixed kinds, oldest first; one belongs to someone else.
    const base = Date.now() - 100000;
    await db.notification.createMany({data: Array.from({length: 25}, (_, i) => ({userId: me, createdAt: new Date(base + i * 1000),
      type: i === 24 ? 'NEW_ATTENDEE' : i === 23 ? 'TYPE_FROM_THE_FUTURE' : 'NEW_FOLLOWER',
      data: i === 24 ? {title: 'Jam', name: 'Zoe'} : {followerName: 'Fan ' + i}, url: i === 24 ? '/en/events/jam' : i === 22 ? '/people/fan' : i === 21 ? 'https://evil.example/' : null}))});
    const foreign = await db.notification.create({data: {userId: other, type: 'NEW_FOLLOWER', data: {followerName: 'Private'}}});

    // Signed-out callers get nothing.
    for (const response of [await list.GET(request('/api/notifications', {cookie: null})), await count.GET(request('/api/notifications/unread-count', {cookie: null})),
      await prefs.GET(request('/api/notifications/preferences', {cookie: null})), await read.POST(request('/api/notifications/read', {method: 'POST', body: {all: true}, cookie: null}))])
      assert.equal(response.status, 401);
    // Mutations need the site's own Origin.
    assert.equal((await read.POST(request('/api/notifications/read', {method: 'POST', body: {all: true}, origin: 'https://evil.example'}))).status, 403);
    assert.equal((await prefs.PUT(request('/api/notifications/preferences', {method: 'PUT', body: {pushChat: false}, origin: null}))).status, 403);

    const first = await list.GET(request('/api/notifications?locale=es'));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('cache-control') || '', /private/);
    const page = await first.json();
    assert.equal(page.items.length, 20); assert.equal(page.unread, 25); assert.ok(page.nextCursor);
    assert.deepEqual(page.items[0], {id: page.items[0].id, type: 'NEW_ATTENDEE', title: 'Nuevo asistente', body: 'Zoe va a Jam.', url: '/es/events/jam', read: false, createdAt: page.items[0].createdAt});
    assert.equal(page.items[1].title, 'Nueva notificación', 'an unknown type is shown, not dropped');
    assert.equal(page.items[2].url, '/es/people/fan', 'a link stored without a locale gets the reader locale');
    assert.equal(page.items[3].url, null, 'a foreign link is not rendered');
    assert.equal(JSON.stringify(page).includes('Private'), false);
    // Without ?locale= the account language is used; the UI locale wins when given.
    assert.equal((await (await list.GET(request('/api/notifications'))).json()).items[0].title, 'Nuevo asistente');
    assert.equal((await (await list.GET(request('/api/notifications?locale=ru'))).json()).items[0].title, 'Новый участник');
    const second = await (await list.GET(request('/api/notifications?locale=es&cursor=' + page.nextCursor))).json();
    assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...page.items, ...second.items].map((item: {id: string}) => item.id)).size, 25, 'pages do not overlap');
    assert.equal((await list.GET(request('/api/notifications?cursor=' + encodeURIComponent("x' OR 1=1")))).status, 400);
    // Somebody else's id as a cursor is ignored rather than used as a window into their rows.
    assert.equal((await (await list.GET(request('/api/notifications?cursor=' + foreign.id))).json()).items.length, 20);

    assert.deepEqual(await (await count.GET(request('/api/notifications/unread-count'))).json(), {count: 25});
    assert.deepEqual(await (await read.POST(request('/api/notifications/read', {method: 'POST', body: {id: page.items[0].id}}))).json(), {updated: 1, unread: 24});
    assert.deepEqual(await (await read.POST(request('/api/notifications/read', {method: 'POST', body: {id: page.items[0].id}}))).json(), {updated: 0, unread: 24}, 'reading twice changes nothing');
    assert.deepEqual(await (await read.POST(request('/api/notifications/read', {method: 'POST', body: {ids: [page.items[1].id, page.items[2].id, foreign.id]}}))).json(), {updated: 2, unread: 22});
    assert.equal((await db.notification.findUniqueOrThrow({where: {id: foreign.id}})).readAt, null, 'another account cannot be touched');
    assert.equal((await (await list.GET(request('/api/notifications'))).json()).items.slice(0, 4).map((item: {read: boolean}) => item.read).join(), 'true,true,true,false');
    for (const body of [{}, {id: ''}, {all: 'yes'}, {ids: []}, {all: true, userId: other}]) assert.equal((await read.POST(request('/api/notifications/read', {method: 'POST', body}))).status, 400, JSON.stringify(body));
    assert.deepEqual(await (await read.POST(request('/api/notifications/read', {method: 'POST', body: {all: true}}))).json(), {updated: 22, unread: 0});
    assert.deepEqual(await (await count.GET(request('/api/notifications/unread-count'))).json(), {count: 0});
    assert.deepEqual(await (await count.GET(request('/api/notifications/unread-count', {cookie: cookies[1]}))).json(), {count: 1}, '"all" means all of my own');

    // Preferences: defaults without a row, partial upsert, strict input.
    const defaults = {pushReminders: true, pushRsvp: true, pushChat: true, emailEvents: true, emailDigest: false};
    assert.deepEqual(await (await prefs.GET(request('/api/notifications/preferences'))).json(), defaults);
    assert.equal(await db.notificationPreference.count({where: {userId: me}}), 0);
    assert.deepEqual(await (await prefs.PUT(request('/api/notifications/preferences', {method: 'PUT', body: {pushChat: false}}))).json(), {...defaults, pushChat: false});
    assert.deepEqual(await (await prefs.PUT(request('/api/notifications/preferences', {method: 'PUT', body: {emailDigest: true, emailEvents: false}}))).json(),
      {...defaults, pushChat: false, emailDigest: true, emailEvents: false});
    assert.deepEqual(await (await prefs.GET(request('/api/notifications/preferences'))).json(), {...defaults, pushChat: false, emailDigest: true, emailEvents: false});
    for (const body of [{}, {pushChat: 'false'}, {userId: other, pushChat: true}, {digestSentAt: null}])
      assert.equal((await prefs.PUT(request('/api/notifications/preferences', {method: 'PUT', body}))).status, 400, JSON.stringify(body));
    assert.equal(await db.notificationPreference.count({where: {userId: other}}), 0);

    // Push: off without keys, then subscribe, move the device to another account, unsubscribe.
    const subscription = {endpoint: 'https://fcm.googleapis.com/fcm/send/api-' + tag, expirationTime: null, keys: {p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22)}};
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
    assert.deepEqual(await (await key.GET()).json(), {key: null});
    const off = await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: subscription}));
    assert.equal(off.status, 503); assert.deepEqual(await off.json(), {error: 'PUSH_UNAVAILABLE'});
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    const exposed = await (await key.GET()).json();
    assert.deepEqual(exposed, {key: keys.publicKey});
    assert.equal(JSON.stringify(exposed).includes(keys.privateKey), false);
    assert.equal((await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: subscription, cookie: null}))).status, 401);
    const ssrf = await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: {...subscription, endpoint: 'https://169.254.169.254/latest/meta-data'}}));
    assert.equal(ssrf.status, 400); assert.deepEqual(await ssrf.json(), {error: 'INVALID_SUBSCRIPTION'});
    assert.equal((await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: {endpoint: subscription.endpoint}}))).status, 400);
    assert.equal((await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: subscription}))).status, 200);
    assert.equal((await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: subscription}))).status, 200, 'repeating is fine');
    assert.equal(await db.pushSubscription.count({where: {endpoint: subscription.endpoint, userId: me}}), 1);
    // Someone else cannot delete it, but signing in on the same browser moves it to them.
    assert.deepEqual(await (await subs.DELETE(request('/api/push/subscriptions', {method: 'DELETE', body: {endpoint: subscription.endpoint}, cookie: cookies[1]}))).json(), {subscribed: false, removed: 0});
    assert.equal(await db.pushSubscription.count({where: {endpoint: subscription.endpoint}}), 1);
    assert.equal((await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: subscription, cookie: cookies[1]}))).status, 200);
    assert.deepEqual((await db.pushSubscription.findMany({where: {endpoint: subscription.endpoint}})).map(row => row.userId), [other]);
    assert.deepEqual(await (await subs.DELETE(request('/api/push/subscriptions', {method: 'DELETE', body: {endpoint: subscription.endpoint}, cookie: cookies[1]}))).json(), {subscribed: false, removed: 1});
    assert.equal(await db.pushSubscription.count({where: {endpoint: subscription.endpoint}}), 0);
    // At most ten devices per account: the oldest ones make room.
    for (let i = 0; i < 12; i++) await db.pushSubscription.create({data: {userId: me, endpoint: 'https://fcm.googleapis.com/fcm/send/old-' + i + '-' + tag, p256dh: 'p', auth: 'a', createdAt: new Date(base + i * 1000)}});
    assert.equal((await subs.PUT(request('/api/push/subscriptions', {method: 'PUT', body: subscription}))).status, 200);
    const kept = await db.pushSubscription.findMany({where: {userId: me}, select: {endpoint: true}});
    assert.equal(kept.length, 10);
    assert.ok(kept.some(row => row.endpoint === subscription.endpoint) && !kept.some(row => /old-[012]-/.test(row.endpoint)));
  } finally {
    for (const [name, value] of [['VAPID_PUBLIC_KEY', saved.pub], ['VAPID_PRIVATE_KEY', saved.priv]] as const) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await db.user.deleteMany({where: {email: {in: emails}}});
    await db.verification.deleteMany({where: {OR: [{identifier: {contains: tag}}, {value: {contains: tag}}]}}).catch(() => undefined);
    await fetch('http://127.0.0.1:8025/api/v1/search?query=' + encodeURIComponent('to:' + tag + '@example.test'), {method: 'DELETE'}).catch(() => undefined);
  }
});
