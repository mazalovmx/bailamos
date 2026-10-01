import {DateTime} from 'luxon';
// Pure helpers (no database): the de-duplication key "date + coordinates + normalized title" and the fuzzy comparison
// that sends near-matches to manual review. Used by the importer and, through eventDedupeKey, by events people create.
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'with', 'to', 'by', 'from',
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'con', 'para', 'por', 'al',
  'и', 'в', 'на', 'с', 'по', 'для', 'от', 'до', 'за', 'из', 'у', 'о']);
export function titleTokens(title: string): string[] {
  const words = title.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const kept = words.filter(word => !STOP.has(word));
  // A title made only of stop words keeps them, otherwise it would compare equal to every other such title.
  return [...new Set(kept.length ? kept : words)].sort();
}
export const normalizeTitle = (title: string) => titleTokens(title).join(' ');
export function localDay(date: Date, timezone: string) {
  const local = DateTime.fromJSDate(date, {zone: timezone});
  return (local.isValid ? local : DateTime.fromJSDate(date, {zone: 'UTC'})).toFormat('yyyy-MM-dd');
}
export type Place = {lat?: number | null; lng?: number | null; cityId?: string | null; precise?: boolean};
const known = (place: Place): place is Place & {lat: number; lng: number} =>
  place.precise !== false && typeof place.lat === 'number' && typeof place.lng === 'number' && Number.isFinite(place.lat) && Number.isFinite(place.lng);
// Three decimals are a grid of roughly 100 m. Without a real address the city stands in for the place.
export const placeKey = (place: Place) => known(place) ? place.lat.toFixed(3) + ',' + place.lng.toFixed(3) : 'city:' + (place.cityId || '?');
export type Keyed = Place & {title: string; startsAt: Date; timezone: string};
export function dedupeKey(item: Keyed) {
  return [localDay(item.startsAt, item.timezone), placeKey(item), normalizeTitle(item.title)].join('|').slice(0, 300);
}
// For events created on the site. Pass `precise: false` when the coordinates are only the city centre (no venue chosen).
export function eventDedupeKey(event: {title: string; startsAt: Date; timezone: string; cityId: string; lat?: number | null; lng?: number | null; precise?: boolean}) {
  return dedupeKey(event);
}
export function distanceM(a: {lat: number; lng: number}, b: {lat: number; lng: number}) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const dice = (a: Set<string>, b: Set<string>) => a.size + b.size ? 2 * [...a].filter(item => b.has(item)).length / (a.size + b.size) : 0;
const bigrams = (text: string) => new Set(Array.from({length: Math.max(text.length - 1, 0)}, (_, index) => text.slice(index, index + 2)));
// 0..1. Word overlap catches reordered and extended titles, character bigrams catch typos and glued words.
export function titleSimilarity(a: string, b: string) {
  const left = titleTokens(a), right = titleTokens(b);
  if (!left.length || !right.length) return 0;
  if (left.join(' ') === right.join(' ')) return 1;
  const small = left.length <= right.length ? left : right, big = new Set(small === left ? right : left);
  const contained = small.length >= 2 && small.every(word => big.has(word)) ? 0.8 : 0;
  return Math.max(dice(new Set(left), new Set(right)), dice(bigrams(left.join(' ')), bigrams(right.join(' '))), contained);
}
export const FUZZY = {metres: 300, hours: 3, similar: 0.6, same: 0.9};
// Same day and (about) the same place with a similar title, or the same title within a few hours.
export function fuzzyMatch(a: Keyed, b: Keyed) {
  const similarity = titleSimilarity(a.title, b.title);
  if (similarity >= FUZZY.same && Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) <= FUZZY.hours * 3600_000) return true;
  if (similarity < FUZZY.similar || localDay(a.startsAt, a.timezone) !== localDay(b.startsAt, b.timezone)) return false;
  // An unknown place cannot tell two events apart, so it counts as near.
  return !known(a) || !known(b) || distanceM(a, b) <= FUZZY.metres;
}
