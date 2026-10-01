import {createHash} from 'node:crypto';
import {MediaError} from '../media/errors';
import {withRedis} from '../redis';
// The only place that talks to Instagram. Link-only embedding: no OAuth, no user tokens, and Instagram media is never
// copied to our storage — we keep the permalink and the oEmbed answer.
import type {EmbedMeta} from '../media/dto';
export type {EmbedMeta};
export type EmbedEntry = {status: 'ok' | 'degraded'; meta: EmbedMeta; html?: string; fetchedAt: number};
export type EmbedResult = {status: 'ok' | 'degraded'; permalink: string; author?: string; title?: string; thumbnailUrl?: string; html?: string};
/** Long-lived fallback (Postgres MediaItem.embedHtml/embedMeta/embedFetched in production). */
export type EmbedStore = {find(permalink: string): Promise<EmbedEntry | null>; save(permalink: string, entry: EmbedEntry): Promise<void>};
export type EmbedDeps = {fetch?: typeof fetch; store?: EmbedStore; now?: () => number};
const DAY_SEC = 86_400;
const DEFAULT_ENDPOINT = 'https://graph.facebook.com/v25.0/instagram_oembed';
// oEmbed is only ever requested from Meta's API hosts, whatever the environment says.
const OEMBED_HOSTS = ['graph.facebook.com', 'graph.instagram.com'];
// Thumbnails are accepted only from Meta's CDNs so the page CSP can list them in img-src.
const THUMBNAIL_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;
const CODE = /^[A-Za-z0-9_-]{5,64}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const KINDS: Record<string, 'p' | 'reel' | 'tv'> = {p: 'p', reel: 'reel', reels: 'reel', tv: 'tv'};
// First path segments that are Instagram sections, not usernames.
const SECTIONS = new Set(['explore', 'accounts', 'stories', 'direct', 'about', 'developer', 'legal', 'reels', 'reel', 'p', 'tv', 'tags', 'locations', 'web', 'api', 'challenge']);
/**
 * Accepts only https://instagram.com or https://www.instagram.com links to one post, reel or IGTV video and returns the
 * canonical permalink (tracking parameters and fragments dropped). A profile link fails with EMBED_PROFILE_URL so the
 * form can say "link to a specific post, not a profile"; anything else fails with EMBED_INVALID_URL.
 */
export function parseInstagramUrl(input: string) {
  const invalid = () => new MediaError('EMBED_INVALID_URL', 400);
  if (typeof input !== 'string' || input.length > 500) throw invalid();
  let url: URL;
  try {url = new URL(input.trim());} catch {throw invalid();}
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid();
  if (url.hostname !== 'instagram.com' && url.hostname !== 'www.instagram.com') throw invalid();
  const parts = url.pathname.split('/').filter(Boolean);
  // Share links may carry the author first: /{username}/p/{code}/.
  const [kindPart, code] = parts.length === 3 && USERNAME.test(parts[0]) && !SECTIONS.has(parts[0].toLowerCase()) ? parts.slice(1) : parts;
  const kind = KINDS[kindPart];
  if (kind && code && CODE.test(code) && parts.length <= 3 && (parts.length === 2 || parts[1] === kindPart))
    return {permalink: 'https://www.instagram.com/' + kind + '/' + code + '/', kind, code};
  // The home page, a profile, or a profile tab such as /{username}/reels/.
  if (parts.length === 0 || (parts.length <= 2 && USERNAME.test(parts[0]) && !SECTIONS.has(parts[0].toLowerCase())))
    throw new MediaError('EMBED_PROFILE_URL', 400);
  throw invalid();
}
function endpoint() {
  try {
    const url = new URL(process.env.INSTAGRAM_OEMBED_URL || DEFAULT_ENDPOINT);
    if (url.protocol === 'https:' && OEMBED_HOSTS.includes(url.hostname) && !url.port && !url.username) return url;
  } catch {/* fall through to the default */}
  return new URL(DEFAULT_ENDPOINT);
}
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
function thumbnail(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && THUMBNAIL_HOSTS.test(url.hostname) && url.href.length <= 2000 ? url.href : undefined;
  } catch {return undefined;}
}
type Fetched = {ok: true; meta: EmbedMeta; html?: string} | {ok: false; retrySec: number; gone: boolean};
/** One upstream call with a timeout; every failure is a value, never an exception. The permalink must already be canonical. */
export async function fetchOEmbed(permalink: string, fetchImpl: typeof fetch = fetch): Promise<Fetched> {
  const url = endpoint();
  url.searchParams.set('url', permalink);
  url.searchParams.set('omitscript', 'true');
  // The specification says Meta serves oEmbed without a token; that is unverified, so a token is sent when configured.
  if (process.env.INSTAGRAM_OEMBED_TOKEN) url.searchParams.set('access_token', process.env.INSTAGRAM_OEMBED_TOKEN);
  const timeout = Number(process.env.INSTAGRAM_OEMBED_TIMEOUT_MS) > 0 ? Number(process.env.INSTAGRAM_OEMBED_TIMEOUT_MS) : 4000;
  try {
    const response = await fetchImpl(url, {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(timeout)});
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // 404: the post is gone or private. Other 4xx (including "token required"): ask again later, but not on every view.
      const client = response.status >= 400 && response.status < 500 && response.status !== 429;
      return {ok: false, gone: response.status === 404, retrySec: response.status === 404 ? 3600 : client ? 900 : 300};
    }
    const body = await response.text();
    if (body.length > 200_000) return {ok: false, gone: false, retrySec: 300};
    const data = JSON.parse(body) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return {ok: false, gone: false, retrySec: 300};
    return {ok: true, html: text(data.html, 20_000), meta: {
      author: text(data.author_name, 100), title: text(data.title, 500), thumbnailUrl: thumbnail(data.thumbnail_url)
    }};
  } catch {
    return {ok: false, gone: false, retrySec: 300};
  }
}
// Cache: Redis is shared between instances; the in-process map covers a Redis outage.
const memory = new Map<string, {entry: EmbedEntry; expires: number}>();
const cacheKey = (permalink: string) => 'embed:ig:' + createHash('sha256').update(permalink).digest('hex');
async function cacheGet(permalink: string, now: number): Promise<EmbedEntry | null> {
  const key = cacheKey(permalink);
  const shared = await withRedis(async redis => {
    const value = await redis.get(key);
    try {return value ? JSON.parse(value) as EmbedEntry : null;} catch {return null;}
  });
  if (shared !== undefined) return shared;
  const local = memory.get(key);
  if (local && local.expires > now) return local.entry;
  memory.delete(key);
  return null;
}
async function cacheSet(permalink: string, entry: EmbedEntry, ttlSec: number, now: number) {
  const key = cacheKey(permalink), ttl = Math.max(1, Math.round(ttlSec));
  if (memory.size >= 1000) memory.delete(memory.keys().next().value as string);
  memory.set(key, {entry, expires: now + ttl * 1000});
  await withRedis(redis => redis.set(key, JSON.stringify(entry), 'EX', ttl));
}
export const clearEmbedMemoryCache = () => memory.clear();
const inflight = new Map<string, Promise<EmbedEntry>>();
async function defaultStore(): Promise<EmbedStore> {return (await import('./store')).dbEmbedStore;}
async function load(permalink: string, deps: EmbedDeps, now: number): Promise<EmbedEntry> {
  const cached = await cacheGet(permalink, now);
  if (cached) return cached;
  const store = deps.store ?? await defaultStore();
  const stored = await store.find(permalink).catch(() => null);
  const age = stored ? (now - stored.fetchedAt) / 1000 : Infinity;
  // A copy fetched within the last day is as good as a Redis hit: no upstream call.
  if (stored && age < DAY_SEC) {
    await cacheSet(permalink, stored, DAY_SEC - age, now);
    return stored;
  }
  const fresh = await fetchOEmbed(permalink, deps.fetch);
  if (fresh.ok) {
    const entry: EmbedEntry = {status: 'ok', meta: fresh.meta, html: fresh.html, fetchedAt: now};
    await cacheSet(permalink, entry, DAY_SEC, now);
    await store.save(permalink, entry).catch(() => {});
    return entry;
  }
  // Meta is unreachable or refuses: an older stored copy keeps the card alive. A removed post degrades to a link.
  const entry: EmbedEntry = stored && !fresh.gone ? stored : {status: 'degraded', meta: {}, fetchedAt: now};
  await cacheSet(permalink, entry, fresh.retrySec, now);
  return entry;
}
/** Like resolveEmbed, but also returns when the data was fetched (for MediaItem.embedFetched). Throws only for invalid URLs. */
export async function lookupEmbed(input: string, deps: EmbedDeps = {}): Promise<{permalink: string; entry: EmbedEntry}> {
  const {permalink} = parseInstagramUrl(input);
  const now = (deps.now ?? Date.now)();
  let pending = inflight.get(permalink);
  if (!pending) {
    pending = load(permalink, deps, now).catch((): EmbedEntry => ({status: 'degraded', meta: {}, fetchedAt: now}))
      .finally(() => inflight.delete(permalink));
    inflight.set(permalink, pending);
  }
  return {permalink, entry: await pending};
}
/**
 * Card data for an Instagram link. Order: Redis (24 h) → stored copy younger than a day → Meta oEmbed → stale stored
 * copy → degraded link card. An invalid or profile URL throws a MediaError; nothing else ever throws.
 */
export async function resolveEmbed(input: string, deps: EmbedDeps = {}): Promise<EmbedResult> {
  const {permalink, entry} = await lookupEmbed(input, deps);
  return entry.status === 'ok' ? {status: 'ok', permalink, ...entry.meta, html: entry.html} : {status: 'degraded', permalink};
}
