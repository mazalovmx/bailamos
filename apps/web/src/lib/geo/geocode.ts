import {db} from '@dance/db';
import {setTimeout as sleep} from 'node:timers/promises';
// Geocoding against a Nominatim-compatible server (GEOCODER_URL) and, for autocomplete, an optional Photon server (PHOTON_URL).
// Every answer is cached in GeocodeCache; network failures yield null / [] and are never thrown to the caller.
export type GeoResult = {lat: number; lng: number; label: string; city?: string; district?: string; countryCode?: string};
type Options = {countryCode?: string; lang?: string; near?: {lat: number; lng: number}};
const PUBLIC_NOMINATIM = 'https://nominatim.openstreetmap.org';
const DAY = 86400000, TTL = 90 * DAY, EMPTY_TTL = DAY;
function settings() {
  const url = (process.env.GEOCODER_URL || PUBLIC_NOMINATIM).replace(/\/+$/, '');
  return {
    url, photon: (process.env.PHOTON_URL || '').replace(/\/+$/, ''),
    // The public server allows one request per second and forbids autocomplete.
    shared: /(^|\.)nominatim\.openstreetmap\.org$/.test(new URL(url).hostname),
    agent: process.env.GEOCODER_USER_AGENT || 'dance-community/0.1 (+' + (process.env.BETTER_AUTH_URL || 'http://localhost:3000') + ')'
  };
}
export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}
export function cacheKey(kind: 'forward' | 'reverse' | 'suggest', query: string, ...scope: (string | undefined)[]): string {
  return [kind + ':' + normalizeQuery(query), ...scope.map(part => (part || '').toLowerCase())].join('|').replace(/\|+$/, '');
}
// One request per 1.1 s within this process; requests beyond a short queue are dropped rather than piled up.
let chain: Promise<unknown> = Promise.resolve(), last = 0, queued = 0;
function throttled<T>(task: () => Promise<T>): Promise<T> {
  if (queued >= 5) return Promise.reject(new Error('GEOCODER_BUSY'));
  queued++;
  const run = chain.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return task();
  }).finally(() => {queued--;});
  chain = run.catch(() => undefined);
  return run;
}
async function fetchJson(url: URL, lang?: string): Promise<unknown> {
  const {agent} = settings();
  const response = await fetch(url, {headers: {'User-Agent': agent, Accept: 'application/json', ...(lang ? {'Accept-Language': lang} : {})}, signal: AbortSignal.timeout(6000)});
  if (!response.ok) throw new Error('GEOCODER_' + response.status);
  return response.json();
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
function fromNominatim(item: unknown): GeoResult | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>, address = (row.address && typeof row.address === 'object' ? row.address : {}) as Record<string, unknown>;
  const lat = Number(row.lat), lng = Number(row.lon), label = text(row.display_name);
  if (row.lat == null || row.lon == null || !valid(lat, lng) || !label) return null;
  return {lat, lng, label: label.slice(0, 300),
    city: text(address.city) || text(address.town) || text(address.village) || text(address.municipality),
    district: text(address.suburb) || text(address.city_district) || text(address.borough) || text(address.neighbourhood),
    countryCode: text(address.country_code)?.toUpperCase()};
}
function fromPhoton(item: unknown): GeoResult | null {
  if (!item || typeof item !== 'object') return null;
  const feature = item as {geometry?: {coordinates?: unknown[]}; properties?: Record<string, unknown>}, p = feature.properties || {};
  const [lng, lat] = (feature.geometry?.coordinates || []).map(Number);
  if (feature.geometry?.coordinates?.length !== 2 || !valid(lat, lng)) return null;
  const street = [text(p.street), text(p.housenumber)].filter(Boolean).join(' ');
  const label = [...new Set([text(p.name), street, text(p.district), text(p.city), text(p.country)].filter(Boolean))].join(', ');
  return label ? {lat, lng, label: label.slice(0, 300), city: text(p.city), district: text(p.district), countryCode: text(p.countrycode)?.toUpperCase()} : null;
}
const clean = (items: (GeoResult | null)[]) => items.filter((item): item is GeoResult => !!item).slice(0, 5);
// Returns cached results, otherwise asks the provider. A failed lookup returns stale data when there is any, and null otherwise.
async function cached(key: string, load: () => Promise<GeoResult[]>): Promise<GeoResult[] | null> {
  try {
    const row = await db.geocodeCache.findUnique({where: {key}});
    const stored = row ? (row.result as {results?: GeoResult[]}).results || [] : null;
    if (row && stored && Date.now() - row.createdAt.getTime() < (stored.length ? TTL : EMPTY_TTL)) return stored;
    let results: GeoResult[];
    try { results = await load(); } catch (error) {
      console.warn(JSON.stringify({level: 'warn', event: 'geocoder_unavailable', message: error instanceof Error ? error.message : 'unknown'}));
      return stored;
    }
    const result = {results: JSON.parse(JSON.stringify(results))};
    await db.geocodeCache.upsert({where: {key}, create: {key, result}, update: {result, createdAt: new Date()}});
    return results;
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'geocode_cache_error', message: error instanceof Error ? error.message : 'unknown'}));
    return null;
  }
}
function nominatim(path: string, params: Record<string, string>, lang?: string): Promise<unknown> {
  const {url, shared} = settings(), target = new URL(url + path);
  for (const [key, value] of Object.entries({...params, format: 'jsonv2', addressdetails: '1'})) target.searchParams.set(key, value);
  return shared ? throttled(() => fetchJson(target, lang)) : fetchJson(target, lang);
}
// Forward geocoding: up to five candidates, best first.
export async function search(query: string, {countryCode, lang}: Options = {}): Promise<GeoResult[]> {
  const q = normalizeQuery(query);
  if (q.length < 3) return [];
  return await cached(cacheKey('forward', q, countryCode, lang), async () => {
    const data = await nominatim('/search', {q, limit: '5', ...(countryCode ? {countrycodes: countryCode.toLowerCase()} : {})}, lang);
    return clean(Array.isArray(data) ? data.map(fromNominatim) : []);
  }) || [];
}
export async function geocode(query: string, options: Options = {}): Promise<GeoResult | null> {
  return (await search(query, options))[0] || null;
}
export async function reverseGeocode(lat: number, lng: number, {lang}: Options = {}): Promise<GeoResult | null> {
  if (!valid(lat, lng)) return null;
  // Five decimals (about a metre) keep the cache key stable while a marker is being dragged around one building.
  const point = lat.toFixed(5) + ',' + lng.toFixed(5);
  const results = await cached(cacheKey('reverse', point, lang), async () => {
    const data = await nominatim('/reverse', {lat: lat.toFixed(5), lon: lng.toFixed(5), zoom: '18'}, lang);
    return clean([fromNominatim(data)]);
  });
  return results?.[0] || null;
}
// Autocomplete. Uses Photon when configured; a private Nominatim otherwise. The shared public Nominatim forbids
// autocomplete, so in that configuration this returns [] and the interface relies on an explicit search.
export async function suggest(query: string, {countryCode, lang, near}: Options = {}): Promise<GeoResult[]> {
  const q = normalizeQuery(query), {photon, shared} = settings();
  if (q.length < 3) return [];
  if (!photon) return shared ? [] : search(q, {countryCode, lang});
  const bias = near ? near.lat.toFixed(1) + ',' + near.lng.toFixed(1) : undefined;
  return await cached(cacheKey('suggest', q, bias, lang), async () => {
    const target = new URL(photon + '/api');
    target.searchParams.set('q', q);
    target.searchParams.set('limit', '5');
    if (near) { target.searchParams.set('lat', near.lat.toFixed(1)); target.searchParams.set('lon', near.lng.toFixed(1)); }
    // Photon only knows a few languages and rejects the others.
    if (lang === 'en') target.searchParams.set('lang', lang);
    const data = await fetchJson(target) as {features?: unknown[]};
    return clean(Array.isArray(data?.features) ? data.features.map(fromPhoton) : []);
  }) || [];
}
export function autocompleteAvailable(): boolean {
  const {photon, shared} = settings();
  return !!photon || !shared;
}
