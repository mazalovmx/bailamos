import ical, {type VEvent} from 'node-ical';
import {DateTime, IANAZone} from 'luxon';
import {MAX_DATES, MAX_INTERVAL, weekdays} from '../schedule';
import {coordinate, plain, safeUrl, STAMP} from './text';
import {MAX_ITEMS, type ImportRecurrence, type ParsedEvent} from './types';
type Stamp = Date & {tz?: string; dateOnly?: boolean};
// SUMMARY;LANGUAGE=es:... arrives as {params, val}.
const value = (input: unknown) => input && typeof input === 'object' && 'val' in input ? (input as {val: unknown}).val : input;
// node-ical builds floating and date-only values in the machine's zone, so the local getters give back what was written.
const wall = (date: Date) => DateTime.fromObject({year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes()}, {zone: 'UTC'}).toFormat(STAMP);
const zoneOf = (date: Stamp) => date.tz && date.tz !== 'Etc/UTC' && date.tz !== 'UTC' && IANAZone.isValidZone(date.tz) ? date.tz : undefined;
const HORIZON_DAYS = 180, EXPANDED = 26, OPEN_ENDED = 26;
// A rule is kept only when lib/schedule.ts can reproduce it: weekly, interval 1..4, plain weekdays, COUNT or UNTIL.
function mapRule(event: VEvent, zone: string | undefined, now: Date): {first: Date; recurrence?: ImportRecurrence} | null {
  const rule = event.rrule!, options = rule.options as Record<string, unknown>;
  const days = ((options.byDay ?? options.byweekday ?? []) as unknown[]).map(String);
  const other = Object.entries(options).some(([key, entry]) => /^by/i.test(key) && !/^by(day|weekday)$/i.test(key) && entry != null && !(Array.isArray(entry) && !entry.length));
  const interval = Number(options.interval ?? 1);
  if (String(options.freq) !== 'WEEKLY' || other || !Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL
    || days.some(day => !(weekdays as readonly string[]).includes(day)) || Object.keys(event.exdate || {}).length || Object.keys(event.recurrences || {}).length) return null;
  const first = event.start >= now ? new Date(event.start) : rule.after(now, true);
  if (!first) return {first: new Date(event.start)};
  if (options.until) {
    const until = DateTime.fromJSDate(new Date(options.until as string), {zone: zone || 'UTC'});
    return until.isValid ? {first, recurrence: {interval, byDay: days, until: until.toFormat('yyyy-MM-dd')}} : null;
  }
  // The series is rolled forward to its next date, so COUNT becomes the number of dates still ahead.
  const left = options.count ? rule.all((_, index) => index < 1000).filter(date => date >= first).length : OPEN_ENDED;
  return left < 2 ? {first} : {first, recurrence: {interval, byDay: days, count: Math.min(left, MAX_DATES)}};
}
export function parseIcal(text: string, now = new Date()): ParsedEvent[] {
  const calendar = ical.sync.parseICS(text), items: ParsedEvent[] = [];
  for (const [key, component] of Object.entries(calendar)) {
    if (!component || (component as {type?: string}).type !== 'VEVENT') continue;
    const event = component as VEvent, start = event.start as Stamp | undefined, end = event.end as Stamp | undefined;
    if (event.recurrenceid) continue;
    const location = plain(value(event.location), 300), geo = event.geo as {lat?: unknown; lon?: unknown} | undefined;
    const item: ParsedEvent = {externalId: plain(event.uid || key, 300), title: plain(value(event.summary), 120),
      description: plain(value(event.description), 5000, true) || undefined, url: safeUrl(value(event.url)),
      cancelled: String(event.status || '').toUpperCase() === 'CANCELLED' || undefined};
    // "Venue, street, city" is the common way to write LOCATION: the first part is the place, the rest the address.
    if (location) {
      const comma = location.indexOf(',');
      item.venueName = (comma > 0 ? location.slice(0, comma) : location).trim().slice(0, 160);
      if (comma > 0) item.address = location;
    }
    const lat = coordinate(geo?.lat, 90), lng = coordinate(geo?.lon, 180);
    if (lat !== undefined && lng !== undefined) {item.lat = lat; item.lng = lng;}
    if (start instanceof Date && !Number.isNaN(start.getTime())) {
      const allDay = !!start.dateOnly || event.datetype === 'date', zone = zoneOf(start);
      const duration = end instanceof Date && end > start ? end.getTime() - start.getTime() : 0;
      if (allDay || !start.tz) {
        item.startsLocal = wall(start);
        if (duration) item.endsLocal = wall(end!);
        item.allDay = allDay || undefined;
      } else {
        item.startsAt = new Date(start);
        if (duration) item.endsAt = new Date(end!);
        item.timezone = zone;
      }
      if (event.rrule) {
        item.rrule = plain(event.rrule.toString().split('\n').pop()?.replace(/^RRULE:/, ''), 200);
        try {
          if (!item.startsAt) item.review = 'RRULE_FLOATING';
          else {
            const mapped = mapRule(event, zone, now);
            if (mapped) {
              item.startsAt = mapped.first;
              item.endsAt = duration ? new Date(mapped.first.getTime() + duration) : undefined;
              item.recurrence = mapped.recurrence;
            } else {
              // Anything else (monthly, exceptions, overrides) is expanded into the dates of the next half year.
              const dates = ical.expandRecurringEvent(event, {from: now, to: new Date(now.getTime() + HORIZON_DAYS * 86400_000)}).slice(0, EXPANDED)
                .map(instance => ({startsAt: new Date(instance.start), endsAt: instance.end > instance.start ? new Date(instance.end) : undefined}));
              if (dates.length) {
                item.occurrences = dates;
                item.startsAt = dates[0].startsAt;
                item.endsAt = dates[0].endsAt;
              }
            }
          }
        } catch {item.review = 'RRULE_UNSUPPORTED';}
      }
    }
    items.push(item);
  }
  // Newest first, so a long calendar history cannot push the upcoming dates out of the per-run limit.
  const time = (item: ParsedEvent) => item.startsAt?.getTime() ?? (item.startsLocal ? Date.parse(item.startsLocal + 'Z') : 0);
  return items.sort((a, b) => time(b) - time(a)).slice(0, MAX_ITEMS);
}
