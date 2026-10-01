import {db, type Prisma} from '@dance/db';
import {descendantIds, type StyleNode} from './tree';
// Reference data changes rarely (seed or admin panel), so one short-lived in-process copy serves autocomplete and directories.
const TTL = 60_000;
export type CityOption = {id: string; slug: string; name: string; countryCode: string; timezone: string};
let styleCache: {at: number; rows: StyleNode[]} | undefined, cityCache: {at: number; rows: CityOption[]} | undefined;
export async function allStyles(): Promise<StyleNode[]> {
  if (!styleCache || Date.now() - styleCache.at > TTL)
    styleCache = {at: Date.now(), rows: await db.danceStyle.findMany({orderBy: {name: 'asc'}, select: {id: true, slug: true, name: true, parentId: true}})};
  return styleCache.rows;
}
export async function allCities(): Promise<CityOption[]> {
  if (!cityCache || Date.now() - cityCache.at > TTL)
    cityCache = {at: Date.now(), rows: await db.city.findMany({orderBy: {name: 'asc'}, select: {id: true, slug: true, name: true, countryCode: true, timezone: true}})};
  return cityCache.rows;
}
// Ids of a style and all of its sub-styles, for "events in this style" queries.
export async function styleDescendantIds(id: string): Promise<string[]> {return descendantIds(await allStyles(), id);}
// Only what anonymous visitors may see: published, not hidden by moderation, not cancelled, still ahead.
export function upcomingOccurrences(event: Prisma.EventWhereInput, now = new Date()): Prisma.EventOccurrenceWhereInput {
  return {cancelled: false, startsAt: {gte: now}, event: {...event, status: 'PUBLISHED', hiddenAt: null}};
}
