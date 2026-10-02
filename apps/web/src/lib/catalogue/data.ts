import {cityName} from './city-name';
import {db, type Prisma} from '@dance/db';
import {descendantIds, type StyleNode} from './tree';
import {localizeCities} from './city-name';
// Reference data changes rarely (seed or admin panel), so one short-lived in-process copy serves autocomplete and directories.
const TTL = 60_000;
// `name` is the local spelling; `names` holds the en/es/ru translations (see cityName in ./city-name).
export type CityOption = {id: string; slug: string; name: string; names: Prisma.JsonValue | null; countryCode: string; timezone: string};
let styleCache: {at: number; rows: StyleNode[]} | undefined, cityCache: {at: number; rows: CityOption[]} | undefined;
export async function allStyles(): Promise<StyleNode[]> {
  if (!styleCache || Date.now() - styleCache.at > TTL)
    styleCache = {at: Date.now(), rows: await db.danceStyle.findMany({orderBy: {name: 'asc'}, select: {id: true, slug: true, name: true, parentId: true}})};
  return styleCache.rows;
}
export async function allCities(): Promise<CityOption[]> {
  if (!cityCache || Date.now() - cityCache.at > TTL)
    cityCache = {at: Date.now(), rows: await db.city.findMany({orderBy: {name: 'asc'}, select: {id: true, slug: true, name: true, names: true, countryCode: true, timezone: true}})};
  return cityCache.rows;
}
// Cities with `name` in the interface language (and `localName` as stored), sorted for that language.
export async function localizedCities(locale: string) {return localizeCities(await allCities(), locale);}
// Ids of a style and all of its sub-styles, for "events in this style" queries.
export async function styleDescendantIds(id: string): Promise<string[]> {return descendantIds(await allStyles(), id);}
// Only what anonymous visitors may see: published, not hidden by moderation, not cancelled, still ahead.
export function upcomingOccurrences(event: Prisma.EventWhereInput, now = new Date()): Prisma.EventOccurrenceWhereInput {
  return {cancelled: false, startsAt: {gte: now}, event: {...event, status: 'PUBLISHED', hiddenAt: null}};
}
// Pages that only have the stored city name (joined rows, payloads) translate it through this lookup:
// the stored name is the local spelling, the result is the name in the reader's language.
export async function cityLabeler(locale: string): Promise<(name: string | null | undefined) => string> {
  const names = new Map((await allCities()).map(city => [city.name, cityName(city, locale)]));
  return name => name ? names.get(name) ?? name : '';
}
