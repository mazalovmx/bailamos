import {db, type Prisma} from '@dance/db';
import {z} from 'zod';
import {DateTime} from 'luxon';
import {eventKinds, classLevels} from '../swing';
import {wallClock} from './time';
import {eventSearch} from '../event-search';
import {type SearchQuery} from '../search-query';
export const MAX_RANGE_DAYS = 100, MAX_OCCURRENCES = 500, FEED_DAYS = 183, FEED_MAX_EVENTS = 500;
export type CalendarFilters = {city: string[]; style: string[]; level: string[]; kind: string[]; extra?:SearchQuery};
const list = (params: URLSearchParams, key: string) => [...new Set(params.getAll(key).map(v => v.trim()).filter(v => v && v.length <= 80))].slice(0, 30);
// Multi-value filters: OR inside a group, AND across groups. Unknown levels/kinds are ignored, like on the events page.
export function calendarFilters(params: URLSearchParams): CalendarFilters {
  const extra=Object.fromEntries(['q','format','intensity','tempo','tag','noPartner','recurring'].filter(key=>params.has(key)).map(key=>[key,params.getAll(key)]));
  return {city: list(params, 'city').filter(c=>c!=='all'), style: list(params, 'style'),...(Object.keys(extra).length?{extra}:{}),
    level: classLevels.filter(v => list(params, 'level').includes(v)), kind: eventKinds.filter(v => list(params, 'kind').includes(v))};
}
const instant = z.string().max(40).transform((value, ctx) => {
  const date = DateTime.fromISO(value, {zone: 'UTC'});
  if (!date.isValid) { ctx.addIssue({code: 'custom', message: 'INVALID_TIME'}); return z.NEVER; }
  return date.toJSDate();
});
// Hard cap on the requested window: a month grid needs about 44 days, nothing legitimate needs more than 100.
export const rangeSchema = z.object({from: instant, to: instant})
  .refine(r => r.to > r.from && r.to.getTime() - r.from.getTime() <= MAX_RANGE_DAYS * 86400000, {message: 'RANGE'});
// Selected styles plus all their descendants in the DanceStyle tree, so "swing" finds Lindy Hop and "balboa" Bal-Swing.
export function withDescendants(selected: string[], styles: {id: string; slug: string; parentId: string | null}[]) {
  const ids = new Set(styles.filter(s => selected.includes(s.slug) || selected.includes(s.id)).map(s => s.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const style of styles) if (style.parentId && ids.has(style.parentId) && !ids.has(style.id)) { ids.add(style.id); grew = true; }
  }
  return [...ids];
}
export async function styleIds(selected: string[]) {
  return selected.length ? withDescendants(selected, await db.danceStyle.findMany({select: {id: true, slug: true, parentId: true}})) : [];
}
// Public visibility lives here: never drafts, never hidden events. Cancelled events are only added for iCal output.
export function eventWhere(filters: CalendarFilters, styles: string[], includeCancelled = false): Prisma.EventWhereInput {
  return {...eventSearch(filters.extra||{}),status: includeCancelled ? {in: ['PUBLISHED', 'CANCELLED']} : 'PUBLISHED', hiddenAt: null,
    ...(filters.city.length ? {city: {OR: [{slug: {in: filters.city}}, {id: {in: filters.city}}]}} : {}),
    ...(filters.style.length ? {styles: {some: {styleId: {in: styles}}}} : {}),
    ...(filters.level.length ? {level: {in: filters.level as Prisma.EnumEventLevelFilter['in']}} : {}),
    ...(filters.kind.length ? {kind: {in: filters.kind as Prisma.EnumEventKindFilter['in']}} : {})};
}
// Occurrences overlapping [from, to): started inside it, or started earlier and still running.
export function overlap(from: Date, to: Date): Prisma.EventOccurrenceWhereInput {
  return {startsAt: {lt: to}, OR: [{startsAt: {gte: from}}, {endsAt: {gt: from}}]};
}
export async function findOccurrences(range: {from: Date; to: Date}, filters: CalendarFilters) {
  const rows = await db.eventOccurrence.findMany({where: {...overlap(range.from, range.to), event: eventWhere(filters, await styleIds(filters.style))},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: MAX_OCCURRENCES + 1,
    select: {id: true, startsAt: true, endsAt: true, cancelled: true, originalStartsAt: true, event: {select: {id: true, slug: true, title: true, timezone: true, kind: true, level: true,
      city: {select: {slug: true, name: true}}, venue: {select: {name: true, hiddenAt: true}}, styles: {select: {style: {select: {slug: true, name: true}}}}}}}});
  return {truncated: rows.length > MAX_OCCURRENCES, occurrences: rows.slice(0, MAX_OCCURRENCES).map(({event, ...o}) => ({
    id: o.id, eventId: event.id, slug: event.slug, title: event.title, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt?.toISOString() ?? null,
    timezone: event.timezone, localStart: wallClock(o.startsAt, event.timezone), localEnd: o.endsAt ? wallClock(o.endsAt, event.timezone) : null,
    cancelled: o.cancelled, moved: !!o.originalStartsAt, kind: event.kind, level: event.level, city: event.city,
    venue: event.venue && !event.venue.hiddenAt ? event.venue.name : null, styles: event.styles.map(s => s.style)}))};
}
export type CalendarOccurrence = Awaited<ReturnType<typeof findOccurrences>>['occurrences'][number];
const icsSelect = {id: true, slug: true, title: true, description: true, timezone: true, status: true, updatedAt: true, startsAt: true, endsAt: true,
  address:true,lat:true,lng:true,version:true,
  city: {select: {name: true}}, venue: {select: {name: true, address: true, hiddenAt: true}}} satisfies Prisma.EventSelect;
const occurrenceSelect = {id: true, startsAt: true, endsAt: true, cancelled: true, originalStartsAt: true} satisfies Prisma.EventOccurrenceSelect;
// One event by id or slug for the .ics download, with every materialized date. Drafts and hidden events do not exist here.
export function findIcsEvent(idOrSlug: string) {
  return db.event.findFirst({where: {OR: [{id: idOrSlug}, {slug: idOrSlug}], status: {in: ['PUBLISHED', 'CANCELLED']}, hiddenAt: null},
    select: {...icsSelect, occurrences: {orderBy: {startsAt: 'asc'}, select: occurrenceSelect}}});
}
// Feed window: from yesterday (UTC midnight, so the body is stable within a day) to about six months ahead.
export function feedRange(now = new Date()) {
  const from = DateTime.fromJSDate(now, {zone: 'UTC'}).startOf('day').minus({days: 1});
  return {from: from.toJSDate(), to: from.plus({days: FEED_DAYS + 1}).toJSDate()};
}
export async function findFeedEvents(filters: CalendarFilters, range = feedRange()) {
  const dates = overlap(range.from, range.to);
  return db.event.findMany({where: {...eventWhere(filters, await styleIds(filters.style), true), occurrences: {some: dates}},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: FEED_MAX_EVENTS,
    select: {...icsSelect, occurrences: {where: dates, orderBy: {startsAt: 'asc'}, select: occurrenceSelect}}});
}
// Human names for the feed title; unknown slugs simply produce no name (and no events).
export async function filterNames(filters: CalendarFilters) {
  const [cities, styles] = await Promise.all([
    filters.city.length ? db.city.findMany({where: {OR: [{slug: {in: filters.city}}, {id: {in: filters.city}}]}, orderBy: {name: 'asc'}, select: {name: true, timezone: true}}) : [],
    filters.style.length ? db.danceStyle.findMany({where: {OR: [{slug: {in: filters.style}}, {id: {in: filters.style}}]}, orderBy: {name: 'asc'}, select: {name: true}}) : []]);
  return {cities, styles};
}
export async function calendarCatalogue() {
  const [cities, styles] = await Promise.all([db.city.findMany({orderBy: {name: 'asc'}, select: {id:true,slug: true, name: true}}),
    db.danceStyle.findMany({orderBy: {name: 'asc'}, select: {id:true,slug: true, name: true}})]);
  return {cities, styles};
}
