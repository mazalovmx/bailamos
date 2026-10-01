import {db, type Prisma} from '@dance/db';
import {DateTime} from 'luxon';
import {classLevels} from '../swing';
import {descendantIds, type StyleNode} from '../catalogue/tree';
// Weekly timetable of regular classes (F12): recurring CLASS / PRACTICE events, one entry per materialized date.
export const REGULAR_KINDS = ['CLASS', 'PRACTICE'] as const;
export const HOST_ROLES = ['OWNER', 'CO_ORGANIZER', 'ARTIST'] as const;
export const DAY_PARTS = ['morning', 'afternoon', 'evening'] as const;
export const MAX_ENTRIES = 400;
export type DayPart = typeof DAY_PARTS[number];
export type Level = typeof classLevels[number];
export type TimetableFilters = {
  cityId?: string | null;
  /** Style ids; the caller passes them already expanded with descendants (see `styleFilter`). */
  styleIds?: string[];
  levels?: Level[];
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays?: number[];
  dayPart?: DayPart | null;
  /** Restricts the timetable to events this profile hosts or teaches (school page). */
  profileId?: string | null;
};
export type Week = {start: string; end: string; iso: string; previous: string; next: string; dates: string[]};
const DAY = /^\d{4}-\d{2}-\d{2}$/, ISO_WEEK = /^\d{4}-W\d{2}$/;
/**
 * The Monday-to-Sunday week containing `value` ("2030-06-12" or "2030-W24"); anything else means the current week in `zone`.
 * A week is seven calendar dates, not an interval of instants: each class is placed on the date its own time zone shows.
 */
export function weekOf(value: string | null | undefined, zone = 'UTC', now = new Date()): Week {
  let day = value && DAY.test(value) ? DateTime.fromISO(value, {zone: 'UTC'}) : value && ISO_WEEK.test(value) ? DateTime.fromISO(value, {zone: 'UTC'}) : null;
  if (!day?.isValid || day.year < 2000 || day.year > 2100) {
    const local = DateTime.fromJSDate(now, {zone});
    day = DateTime.fromISO((local.isValid ? local : DateTime.fromJSDate(now, {zone: 'UTC'})).toISODate()!, {zone: 'UTC'});
  }
  const monday = day.startOf('day').minus({days: day.weekday - 1});
  const date = (offset: number) => monday.plus({days: offset}).toISODate()!;
  return {start: date(0), end: date(6), iso: monday.toFormat("kkkk-'W'WW"), previous: date(-7), next: date(7), dates: [0, 1, 2, 3, 4, 5, 6].map(date)};
}
export function dayPartOf(minutes: number): DayPart {return minutes < 12 * 60 ? 'morning' : minutes < 17 * 60 ? 'afternoon' : 'evening';}
/** Query-string helpers shared by the page and the API: unknown values are ignored, never an error. */
export const parseLevels = (value: string | null | undefined) => classLevels.filter(level => (value || '').split(',').includes(level));
export const parseWeekdays = (value: string | null | undefined) => [...new Set((value || '').split(',').map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7))];
export const parseDayPart = (value: string | null | undefined) => DAY_PARTS.find(part => part === value) ?? null;
/** A style (slug or id) plus all of its sub-styles. `null` = no such style, which must yield an empty timetable rather than "all". */
export function styleFilter(styles: readonly StyleNode[], value: string | null | undefined): string[] | null | undefined {
  if (!value) return undefined;
  const style = styles.find(item => item.slug === value || item.id === value);
  return style ? descendantIds(styles, style.id) : null;
}
const select = {id: true, startsAt: true, endsAt: true, event: {select: {id: true, slug: true, title: true, timezone: true, kind: true, level: true, priceText: true,
  city: {select: {slug: true, name: true}}, venue: {select: {id: true, name: true, address: true, hiddenAt: true}},
  styles: {select: {style: {select: {slug: true, name: true}}}},
  members: {where: {role: {in: ['OWNER', 'CO_ORGANIZER']}, profile: {hiddenAt: null}}, select: {role: true, profile: {select: {handle: true, name: true, type: true}}}}}}} satisfies Prisma.EventOccurrenceSelect;
type Row = Prisma.EventOccurrenceGetPayload<{select: typeof select}>;
const hostRank = (host: {type: string; role: string}) => (host.type === 'SCHOOL' ? 0 : host.type === 'ORGANIZER' ? 1 : 2) * 2 + (host.role === 'OWNER' ? 0 : 1);
function entry(row: Row) {
  const {event} = row, start = DateTime.fromJSDate(row.startsAt, {zone: event.timezone}), local = start.isValid ? start : DateTime.fromJSDate(row.startsAt, {zone: 'UTC'});
  const end = row.endsAt ? DateTime.fromJSDate(row.endsAt, {zone: local.zone}) : null;
  // One profile can hold two roles on an event; it is listed once, schools first.
  const hosts = [...new Map(event.members.map(member => ({...member.profile, role: member.role})).sort((a, b) => hostRank(a) - hostRank(b) || a.name.localeCompare(b.name))
    .map(host => [host.handle, {handle: host.handle, name: host.name, type: host.type}] as const)).values()];
  return {id: row.id, eventId: event.id, slug: event.slug, title: event.title, kind: event.kind, level: event.level, priceText: event.priceText,
    startsAt: row.startsAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null, timezone: event.timezone,
    date: local.toISODate()!, weekday: local.weekday, localStart: local.toFormat('HH:mm'), localEnd: end ? end.toFormat('HH:mm') : null, minutes: local.hour * 60 + local.minute,
    city: event.city, venue: event.venue && !event.venue.hiddenAt ? {id: event.venue.id, name: event.venue.name, address: event.venue.address} : null,
    styles: event.styles.map(item => item.style).sort((a, b) => a.name.localeCompare(b.name)), hosts};
}
export type TimetableEntry = ReturnType<typeof entry>;
export type Timetable = {week: Week; days: {date: string; weekday: number; entries: TimetableEntry[]}[]; total: number; truncated: boolean};
/**
 * Bounded query on EventOccurrence: only published, non-hidden events and dates that are not cancelled.
 * The window is widened by the largest UTC offsets and the rows are then placed by their own local date.
 */
export async function weekTimetable(week: Week, filters: TimetableFilters = {}): Promise<Timetable> {
  const from = DateTime.fromISO(week.start, {zone: 'UTC'}).minus({hours: 14}).toJSDate(), to = DateTime.fromISO(week.start, {zone: 'UTC'}).plus({days: 7, hours: 12}).toJSDate();
  const rows = filters.styleIds && !filters.styleIds.length ? [] : await db.eventOccurrence.findMany({
    where: {cancelled: false, startsAt: {gte: from, lt: to}, event: {status: 'PUBLISHED', hiddenAt: null, rrule: {not: null}, kind: {in: [...REGULAR_KINDS]},
      ...(filters.cityId ? {cityId: filters.cityId} : {}),
      ...(filters.styleIds ? {styles: {some: {styleId: {in: filters.styleIds}}}} : {}),
      ...(filters.levels?.length ? {level: {in: filters.levels}} : {}),
      ...(filters.profileId ? {members: {some: {profileId: filters.profileId, role: {in: [...HOST_ROLES]}}}} : {})}},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: MAX_ENTRIES + 1, select});
  const inWeek = new Set(week.dates);
  const entries = rows.slice(0, MAX_ENTRIES).map(entry).filter(item => inWeek.has(item.date)
    && (!filters.weekdays?.length || filters.weekdays.includes(item.weekday)) && (!filters.dayPart || dayPartOf(item.minutes) === filters.dayPart));
  // Within a day the order is the wall-clock time people read on the page, not the instant (zones may differ).
  const days = week.dates.map((date, index) => ({date, weekday: index + 1,
    entries: entries.filter(item => item.date === date).sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title))}));
  return {week, days, total: entries.length, truncated: rows.length > MAX_ENTRIES};
}
