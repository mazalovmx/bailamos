import {DateTime} from 'luxon';
import {normalize, rankMatches} from '../../catalogue/search';
import {haversine} from '../../geo/coarsen';
import type {ParsedAnnouncement} from './contract';
// Post-processing happens here, on the server, never in the model: dates are checked against the city's zone,
// styles are matched to the directory, the address goes through the geocoder. Whatever cannot be resolved stays
// empty and is reported, so the form shows it for the organizer to fill in.
export type Style = {id: string; slug: string; name: string};
export type Venue = {id: string; name: string; address: string};
export type City = {id: string; name: string; timezone: string; lat: number; lng: number; countryCode?: string};
export type Geocode = (query: string, options: {countryCode?: string}) => Promise<{lat: number; lng: number} | null>;
export type Suggestion = {
  // Values for the event form, keyed by its field names; only fields found in the text are present.
  fields: Record<string, string>;
  notes: {artists: string[]; instagramUrls: string[]; unmatchedStyles: string[]; otherStyles: string[]; venueName: string | null; address: string | null};
  warnings: string[];
  confidence: number;
};
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
// A wall-clock time that exists in the zone; skipped (DST gap) or malformed times are dropped rather than guessed.
function localTime(value: string | null, zone: string) {
  if (!value) return null;
  const text = value.slice(0, 16);
  if (!LOCAL.test(text)) return null;
  const moment = DateTime.fromISO(text, {zone});
  return moment.isValid && moment.toFormat("yyyy-MM-dd'T'HH:mm") === text ? {text, moment} : null;
}
const LEVELS: [string, RegExp][] = [
  ['OPEN', /\b(all levels|open level|todos los niveles|abierto)\b|все уровни|любой уровень|для всех/],
  ['NEWCOMER', /\b(absolute beginners?|newcomers?|from scratch|desde cero|iniciaci[oó]n)\b|с нуля|новичк/],
  ['BEGINNER', /\b(beginners?|principiantes?|b[aá]sico)\b|начинающ/],
  ['IMPROVER', /\b(improvers?|beginner[- ]intermediate)\b|продолжающ/],
  ['INTERMEDIATE', /\b(intermediate|intermedio)\b|средн/],
  ['ADVANCED', /\b(advanced|avanzado)\b|продвинут/],
  ['PRO', /\b(professional|pro|profesional)\b|профессионал/]
];
// The event type is read from the source text itself: the model contract has no such field.
const KINDS: [string, RegExp][] = [
  ['FESTIVAL', /\bfestival\b|фестивал/],
  ['WORKSHOP', /\b(workshop|taller)\b|воркшоп|семинар/],
  ['MASTERCLASS', /\bmaster ?class\b|мастер-?класс/],
  ['INTENSIVE', /\b(intensive|intensivo)\b|интенсив/],
  ['PRACTICE', /\b(practice|pr[aá]ctica|practica)\b|практик/],
  ['SOCIAL', /\b(social|party|fiesta|milonga|night|noche)\b|вечеринк|танцевальный вечер/],
  ['CLASS', /\b(class|classes|lesson|course|clase|clases|curso)\b|занят|урок|курс/]
];
export function matchKind(source: string) {
  const text = source.toLocaleLowerCase();
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
export function matchLevel(value: string | null) {
  const text = (value || '').toLocaleLowerCase();
  return text ? LEVELS.find(([, pattern]) => pattern.test(text))?.[0] ?? null : null;
}
// A style is taken only when the directory has it under that code or name; anything else is reported, not substituted.
export function matchStyles(raw: readonly string[], styles: readonly Style[]) {
  const matched: Style[] = [], unmatched: string[] = [];
  for (const name of raw) {
    const key = normalize(name);
    const exact = styles.find(style => style.slug === name.trim().toLowerCase() || normalize(style.name) === key || normalize(style.slug) === key);
    // Fuzzy matching accepts only a clear prefix hit of a reasonably long name, never a bare substring.
    const style = exact || (key.length >= 4 ? rankMatches(styles, name, 1).find(item => normalize(item.name).startsWith(key) || normalize(item.slug).startsWith(key)) : undefined);
    if (style) {if (!matched.some(item => item.id === style.id)) matched.push(style);} else if (!unmatched.includes(name)) unmatched.push(name);
  }
  return {matched, unmatched};
}
const instagram = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^(www\.)?instagram\.com$/.test(url.hostname) ? url.origin + url.pathname : null;
  } catch {return null;}
};
export async function toSuggestion(parsed: ParsedAnnouncement, source: string, context: {city: City; styles: readonly Style[]; venues: readonly Venue[]; geocode: Geocode; now?: Date}): Promise<Suggestion> {
  const {city} = context, zone = city.timezone, fields: Record<string, string> = {}, warnings: string[] = [];
  const title = parsed.title?.replace(/\s+/g, ' ').slice(0, 120) || '';
  if (title.length >= 3) fields.title = title;
  // The announcement itself is the description: it is the organizer's own text, not something the model wrote.
  if (source.length >= 10) fields.description = source.slice(0, 5000);
  const start = localTime(parsed.startsAtLocal, zone), end = localTime(parsed.endsAtLocal, zone);
  if (start) {
    fields.startsLocal = start.text;
    if (start.moment.toMillis() < (context.now ?? new Date()).getTime()) warnings.push('PAST_DATE');
    if (end && end.moment > start.moment) fields.endsLocal = end.text;
  } else if (parsed.startsAtLocal) warnings.push('DATE_UNCLEAR');
  if (parsed.recurrence === 'weekly') warnings.push('RECURS_WEEKLY');
  if (parsed.recurrence === 'monthly') warnings.push('RECURS_MONTHLY');
  const {matched, unmatched} = matchStyles(parsed.styles, context.styles);
  if (matched[0]) fields.styleId = matched[0].id;
  const kind = matchKind(source);
  if (kind) fields.kind = kind;
  const level = matchLevel(parsed.level);
  if (level) fields.level = level;
  // The price stays a string exactly as written: splitting it into amount and currency is too error-prone.
  if (parsed.price) fields.priceText = parsed.price.slice(0, 120);
  // Place: a venue of this city with that name, else the geocoded address as an exact point, else nothing.
  const venueKey = normalize(parsed.venueName || '');
  const venue = venueKey.length >= 3 ? context.venues.find(item => normalize(item.name) === venueKey) : undefined;
  if (venue) fields.venueId = venue.id;
  else if (parsed.address || parsed.venueName) {
    // The street address is tried first: a venue name in front of it often confuses the geocoder.
    const queries = [...new Set([[parsed.address, city.name], [parsed.venueName, parsed.address, city.name], [parsed.venueName, city.name]]
      .filter(parts => parts[0]).map(parts => parts.filter(Boolean).join(', ')))];
    let point: {lat: number; lng: number} | null = null;
    for (const query of queries) {
      point = await context.geocode(query, {countryCode: city.countryCode}).catch(() => null);
      if (point && haversine(point, city) <= 150000) break;
      point = null;
    }
    if (point && haversine(point, city) <= 150000) {fields.lat = String(point.lat); fields.lng = String(point.lng);}
    else warnings.push('ADDRESS_NOT_FOUND');
  }
  return {fields, warnings, confidence: parsed.confidence,
    notes: {artists: parsed.artists, instagramUrls: [...new Set(parsed.instagramUrls.map(instagram).filter((url): url is string => !!url))],
      unmatchedStyles: unmatched, otherStyles: matched.slice(1).map(style => style.name), venueName: venue ? null : parsed.venueName, address: parsed.address}};
}
