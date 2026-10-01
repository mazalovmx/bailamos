/* global self, caches, fetch, Request, Response, URL, Headers */
// Dance Community service worker: offline agenda, static assets and Web Push. Plain JS, no build step.
// Bump VERSION whenever the caching rules change: old caches are deleted on activate.
const VERSION = 'v1';
const CACHES = {shell: 'dc-shell-' + VERSION, pages: 'dc-pages-' + VERSION, assets: 'dc-static-' + VERSION, images: 'dc-images-' + VERSION};
const LIMITS = {pages: 40, assets: 160, images: 80};
const LOCALES = ['en', 'es', 'ru'];
const PAGE_FRESH_MS = 10 * 60 * 1000;
const ORIGIN = self.location.origin;

// ---------- Pure rules (tests evaluate this block with node:vm) ----------
// The only HTML that is ever stored: the agenda, an event, a city agenda and the calendar.
const OFFLINE_PAGES = /^\/(en|es|ru)\/(events|calendar|events\/[^/]+|cities\/[^/]+)\/?$/;
// Belt and braces: API, auth, account, messages and editing screens are refused before any other rule is looked at.
const NEVER = new RegExp('^/api(/|$)|^/admin(/|$)|^/(en|es|ru)/events/(new|[^/]+/edit)/?$|^/(en|es|ru)/('
  + 'login|register|forgot-password|reset-password|settings|profile|my-events|messages|chat|notifications|onboarding|invites|matching|partners|moderation|admin'
  + ')(/|$)');
// What to do with a request: 'page' (network first, public copy kept for offline), 'navigate' (network only, offline
// screen as fallback), 'static' / 'image' (stale-while-revalidate) or 'none' (the worker does not touch it).
function cacheRule(request) {
  let url;
  try {url = new URL(request.url);} catch {return 'none';}
  if (request.method !== 'GET' || url.origin !== ORIGIN) return 'none';
  const path = url.pathname, navigation = request.mode === 'navigate';
  // API calls (sign-in callbacks and downloads included) always go straight to the network.
  if (/^\/api(\/|$)/.test(path)) return 'none';
  if (NEVER.test(path)) return navigation ? 'navigate' : 'none';
  if (navigation) return OFFLINE_PAGES.test(path) ? 'page' : 'navigate';
  if (path.startsWith('/_next/static/')) return 'static';
  if (request.destination === 'image' && /^\/(images|icons|_next\/image)(\/|$)|^\/icon\.svg$/.test(path)) return 'image';
  return 'none';
}
// Whether a response may be written to a cache under the given rule.
// Stored pages are fetched WITHOUT cookies (see remember()), so they are the public, signed-out rendering. Next.js marks
// every dynamically rendered page "private, no-store" whoever asks, which is why that header cannot veto the four page
// routes; it does veto everything else, and a Set-Cookie header vetoes all of them.
function storable(rule, response) {
  if (rule !== 'page' && rule !== 'static' && rule !== 'image') return false;
  if (response.status !== 200 || response.type !== 'basic' || response.redirected) return false;
  if (response.setCookie) return false;
  if (rule === 'page') return /^text\/html\b/i.test(response.contentType || '');
  return !/\b(private|no-store)\b/i.test(response.cacheControl || '');
}
// Any sign-in, sign-out or account deletion empties the page cache.
function wipesPages(method, path) {
  return method !== 'GET' && method !== 'HEAD' && (/^\/api\/auth(\/|$)/.test(path) || path === '/api/account');
}
// Push payload links are opened only when they are plain paths on this site.
function safePath(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/[\\\s]/.test(value) ? value : '/';
}
const localeOf = path => LOCALES.find(locale => path === '/' + locale || path.startsWith('/' + locale + '/')) || LOCALES[0];
self.swRules = {VERSION, cacheRule, storable, wipesPages, safePath, localeOf};
// ---------- End of pure rules ----------

const describe = response => ({status: response.status, type: response.type, redirected: response.redirected,
  setCookie: response.headers.has('set-cookie'), contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control')});
// Cache keys come back in insertion order and put() re-inserts, so deleting from the front drops the least recently stored.
async function trim(name, limit) {
  const cache = await caches.open(name), keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
// Keeps a public (cookie-less) copy of an agenda or event page the visitor has just looked at.
async function remember(href) {
  const cache = await caches.open(CACHES.pages), known = await cache.match(href);
  if (known && Date.now() - Number(known.headers.get('x-sw-stored') || 0) < PAGE_FRESH_MS) return;
  const response = await fetch(new Request(href, {credentials: 'omit', headers: {Accept: 'text/html'}}));
  if (!storable('page', describe(response))) return;
  const headers = new Headers({'Content-Type': response.headers.get('content-type') || 'text/html; charset=utf-8', 'x-sw-stored': String(Date.now())});
  await cache.delete(href);
  await cache.put(href, new Response(await response.blob(), {status: 200, headers}));
  await trim(CACHES.pages, LIMITS.pages);
}
async function offlineScreen(path) {
  const shell = await caches.open(CACHES.shell);
  return await shell.match('/' + localeOf(path) + '/offline') || new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>'
    + '<h1>Offline</h1><p>You are offline. · Estás sin conexión. · Нет подключения.</p>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}
async function savedPage(url) {
  const cache = await caches.open(CACHES.pages);
  // The exact view first, then the same page with whatever filters were last seen.
  return await cache.match(url.href) || await cache.match(url.href, {ignoreSearch: true}) || offlineScreen(url.pathname);
}
async function staleWhileRevalidate(event, rule) {
  const cache = await caches.open(rule === 'static' ? CACHES.assets : CACHES.images), cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async response => {
    if (storable(rule, describe(response))) {
      await cache.put(event.request, response.clone());
      await trim(rule === 'static' ? CACHES.assets : CACHES.images, rule === 'static' ? LIMITS.assets : LIMITS.images);
    }
    return response;
  });
  if (!cached) return refresh;
  event.waitUntil(refresh.catch(() => undefined));
  return cached;
}
const wipePages = () => caches.delete(CACHES.pages);

self.addEventListener('install', event => {
  // The offline screen in every language, rendered without cookies, plus the scripts and styles it references.
  event.waitUntil((async () => {
    const shell = await caches.open(CACHES.shell), assets = await caches.open(CACHES.assets);
    await Promise.allSettled(LOCALES.map(async locale => {
      const path = '/' + locale + '/offline', response = await fetch(new Request(path, {credentials: 'omit'}));
      if (!storable('page', describe(response))) return;
      const html = await response.clone().text();
      await shell.put(path, new Response(html, {status: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}}));
      const files = [...new Set(html.match(/\/_next\/static\/[A-Za-z0-9_\-./%~@()[\]]+\.(?:js|css|woff2)/g) || [])].slice(0, 60);
      await Promise.allSettled(files.map(async file => {
        const asset = await fetch(file);
        if (storable('static', describe(asset))) await assets.put(file, asset);
      }));
    }));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const current = Object.values(CACHES);
    await Promise.all((await caches.keys()).filter(name => name.startsWith('dc-') && !current.includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const {request} = event, url = new URL(request.url);
  if (url.origin === ORIGIN && wipesPages(request.method, url.pathname)) {event.waitUntil(wipePages()); return;}
  const rule = cacheRule(request);
  if (rule === 'none') return;
  if (rule === 'static' || rule === 'image') {event.respondWith(staleWhileRevalidate(event, rule)); return;}
  event.respondWith(fetch(request).then(response => {
    if (rule === 'page' && response.status === 200 && !response.redirected) event.waitUntil(remember(url.href).catch(() => undefined));
    return response;
  }, () => rule === 'page' ? savedPage(url) : offlineScreen(url.pathname)));
});
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'SIGNED_OUT') event.waitUntil(wipePages());
  // In-app (client side) navigation never reaches the fetch handler as a navigation, so the page reports what was viewed.
  if (data.type === 'VIEWED' && typeof data.url === 'string' && cacheRule({method: 'GET', mode: 'navigate', url: data.url}) === 'page')
    event.waitUntil(remember(new URL(data.url).href).catch(() => undefined));
});
self.addEventListener('push', event => {
  let data = {};
  try {data = event.data ? event.data.json() : {};} catch {data = {};}
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'Dance Community';
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {body: typeof data.body === 'string' ? data.body.slice(0, 300) : '',
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: typeof data.tag === 'string' ? data.tag : undefined, data: {url: safePath(data.url)}}),
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => list.forEach(client => client.postMessage({type: 'PUSH_RECEIVED'})))
  ]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), ORIGIN).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const open = list.find(client => client.url === target) || list[0];
    if (!open) return self.clients.openWindow(target);
    if (open.url !== target && 'navigate' in open) await open.navigate(target).catch(() => self.clients.openWindow(target));
    return open.focus().catch(() => undefined);
  })());
});
// The browser replaced the subscription on its own: store the new one for the signed-in account.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const options = event.oldSubscription && event.oldSubscription.options;
    const next = event.newSubscription || (options ? await self.registration.pushManager.subscribe(options) : null);
    if (next) await fetch('/api/push/subscriptions', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(next.toJSON())});
  })().catch(() => undefined));
});
