import {db} from '@dance/db';
import {nearestCity} from './nearby';
// City detection without a paid geo-IP service: an explicit choice wins, then the proxy/CDN headers, then the default.
export type LocatedCity = {id: string; slug: string; name: string; countryCode: string; lat: number; lng: number};
export type Location = {city: LocatedCity | null; source: 'browser' | 'cookie' | 'coordinates' | 'city' | 'country' | 'default'; detected: LocatedCity | null};
const select = {id: true, slug: true, name: true, countryCode: true, lat: true, lng: true} as const;
// A detected point further away than this is not "in" any seeded city.
const MAX_DISTANCE = 300000;
const headerPairs = [['x-vercel-ip-latitude', 'x-vercel-ip-longitude'], ['cf-iplatitude', 'cf-iplongitude'], ['cloudfront-viewer-latitude', 'cloudfront-viewer-longitude']];
const cityHeaders = ['x-vercel-ip-city', 'cf-ipcity', 'cloudfront-viewer-city', 'x-appengine-city'];
const countryHeaders = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-appengine-country', 'x-country-code'];
const first = (headers: Headers, names: string[]) => names.map(name => headers.get(name)?.trim()).find(Boolean);
export function headerHints(headers: Headers): {lat?: number; lng?: number; city?: string; countryCode?: string} {
  let lat: number | undefined, lng: number | undefined;
  const pairs = [...headerPairs.map(([a, b]) => [headers.get(a), headers.get(b)]), (headers.get('x-appengine-citylatlong') || '').split(',')];
  for (const [a, b] of pairs) {
    const y = Number(a), x = Number(b);
    if (a && b && Number.isFinite(y) && Number.isFinite(x) && Math.abs(y) <= 90 && Math.abs(x) <= 180 && (y !== 0 || x !== 0)) { lat = y; lng = x; break; }
  }
  let city = first(headers, cityHeaders);
  // Vercel percent-encodes city names.
  try { city = city ? decodeURIComponent(city) : city; } catch { /* keep the raw value */ }
  const country = first(headers, countryHeaders)?.toUpperCase();
  // XX and T1 are Cloudflare's "unknown" and "Tor" markers.
  return {lat, lng, city: city?.slice(0, 80), countryCode: country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : undefined};
}
export function cookieValue(headers: Headers, name: string): string | undefined {
  for (const part of (headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
    }
  }
}
async function within(lat: number, lng: number): Promise<LocatedCity | null> {
  const city = await nearestCity(lat, lng);
  if (!city || city.distanceM > MAX_DISTANCE) return null;
  return {id: city.id, slug: city.slug, name: city.name, countryCode: city.countryCode, lat: city.lat, lng: city.lng};
}
async function fromHeaders(headers: Headers): Promise<{city: LocatedCity; source: Location['source']} | null> {
  const hint = headerHints(headers);
  if (hint.lat !== undefined && hint.lng !== undefined) {
    const city = await within(hint.lat, hint.lng);
    if (city) return {city, source: 'coordinates'};
  }
  if (hint.city) {
    const city = await db.city.findFirst({where: {name: {equals: hint.city, mode: 'insensitive'}, ...(hint.countryCode ? {countryCode: hint.countryCode} : {})}, select});
    if (city) return {city, source: 'city'};
  }
  if (hint.countryCode) {
    // Only unambiguous: a country with several seeded cities says nothing about which one.
    const cities = await db.city.findMany({where: {countryCode: hint.countryCode}, select, take: 2});
    if (cities.length === 1) return {city: cities[0], source: 'country'};
  }
  return null;
}
export async function defaultCity(): Promise<LocatedCity | null> {
  const slug = process.env.DEFAULT_CITY_SLUG;
  return (slug ? await db.city.findUnique({where: {slug}, select}) : null) || db.city.findFirst({orderBy: {name: 'asc'}, select});
}
// `point` is a position the user explicitly shared from the browser ("near me"); it is used once and never stored.
export async function locate(headers: Headers, point?: {lat: number; lng: number}): Promise<Location> {
  if (point) {
    const city = await within(point.lat, point.lng);
    return {city, source: 'browser', detected: city};
  }
  const slug = cookieValue(headers, 'city'), detected = await fromHeaders(headers);
  const chosen = slug && /^[a-z0-9-]{1,60}$/.test(slug) ? await db.city.findUnique({where: {slug}, select}) : null;
  if (chosen) return {city: chosen, source: 'cookie', detected: detected?.city || null};
  if (detected) return {city: detected.city, source: detected.source, detected: detected.city};
  return {city: await defaultCity(), source: 'default', detected: null};
}
