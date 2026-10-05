import ical, {ICalCalendarMethod, ICalEventStatus} from 'ical-generator';
import {createHash} from 'node:crypto';
import {inZone, vtimezone} from './time';
export type IcsOccurrence = {id: string; startsAt: Date; endsAt: Date | null; cancelled: boolean; originalStartsAt?: Date | null};
// SEQUENCE of a moved date counts seconds from here, which keeps it far inside the 32-bit range.
const SEQUENCE_EPOCH = Date.UTC(2020, 0, 1) / 1000;
export type IcsEvent = {id: string; slug: string; title: string; description: string | null; timezone: string; status: string; updatedAt: Date;
  version?:number;
  startsAt: Date; endsAt: Date | null; city: {name: string}; address?:string|null; lat?:number|null; lng?:number|null; venue?: {name: string; address: string; hiddenAt: Date | null} | null; occurrences: IcsOccurrence[]};
export function eventLocation(event: Pick<IcsEvent, 'city' | 'venue' | 'address' | 'lat' | 'lng'>) {
  const venue=event.venue&&!event.venue.hiddenAt?event.venue:null;
  const address=venue?.address||event.address;
  const place=[venue?.name,address,address?.toLocaleLowerCase().includes(event.city.name.toLocaleLowerCase())?null:event.city.name].filter(Boolean).join(', ');
  return place+(!venue&&event.lat!=null&&event.lng!=null?' · https://www.openstreetmap.org/?mlat='+event.lat+'&mlon='+event.lng:'');
}
// One VEVENT per materialized occurrence: a recurring series is exported as its real dates, so a single cancelled
// date is exact and no client has to re-expand an RRULE across DST changes.
export function buildCalendar(input: {name: string; origin: string; locale?: string; events: IcsEvent[]; ttlSeconds?: number; timezone?: string | null}) {
  const host = new URL(input.origin).host, all = input.events.flatMap((e): {startsAt: Date; endsAt: Date | null}[] => e.occurrences.length ? e.occurrences : [e]);
  const times = all.flatMap(o => [o.startsAt.getTime(), (o.endsAt || o.startsAt).getTime()]);
  const from = new Date(times.length ? Math.min(...times) : 0), to = new Date(times.length ? Math.max(...times) : 0);
  const calendar = ical({name: input.name, prodId: {company: 'dance-community', product: 'calendar', language: 'EN'}, method: ICalCalendarMethod.PUBLISH,
    ...(input.ttlSeconds ? {ttl: input.ttlSeconds} : {}),
    timezone: {name: input.timezone || null, generator: zone => vtimezone(zone, from, to)}});
  for (const event of input.events) {
    // An event without materialized rows (legacy data) is exported from its own start, with the event id as UID.
    const rows: IcsOccurrence[] = event.occurrences.length ? event.occurrences : [{id: event.id, startsAt: event.startsAt, endsAt: event.endsAt, cancelled: false}];
    for (const occurrence of rows) {
      const url = input.origin + '/' + (input.locale || 'en') + '/events/' + event.slug + '?date=' + encodeURIComponent(occurrence.startsAt.toISOString());
      const cancelled = event.status === 'CANCELLED' || occurrence.cancelled;
      // A moved date keeps its UID and is exported at its new time. Its SEQUENCE follows the event's timestamp, which
      // every move advances, so each revision outranks the copy a client already holds (RFC 5545 §3.8.7.4).
      const revision = event.version?event.version*2:Math.max(1, Math.floor(event.updatedAt.getTime() / 1000) - SEQUENCE_EPOCH);
      calendar.createEvent({id: occurrence.id + '@' + host,
        // Luxon DateTime in the event zone + `timezone` makes ical-generator write DTSTART;TZID=<zone>:<wall clock>.
        start: inZone(occurrence.startsAt, event.timezone), ...(occurrence.endsAt ? {end: inZone(occurrence.endsAt, event.timezone)} : {}),
        timezone: event.timezone, summary: event.title, location: eventLocation(event), url,
        description: [event.description?.trim(), url].filter(Boolean).join('\n\n'),
        status: cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
        // DTSTAMP/LAST-MODIFIED come from the data, not from the clock: identical data gives an identical body and ETag.
        stamp: event.updatedAt, lastModified: event.updatedAt, sequence: revision + (cancelled ? 1 : 0)});
    }
  }
  return calendar.toString();
}
export function etagOf(body: string) { return '"' + createHash('sha1').update(body).digest('base64url') + '"'; }
// 304 decision. If-None-Match wins over If-Modified-Since (RFC 9110 §13.1.3); weak validators compare equal.
export function notModified(request: Request, etag: string, lastModified: Date) {
  const match = request.headers.get('if-none-match');
  if (match !== null) return match.trim() === '*' || match.split(',').map(v => v.trim().replace(/^W\//, '')).includes(etag);
  const since = Date.parse(request.headers.get('if-modified-since') || '');
  return Number.isFinite(since) && Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
}
export function calendarResponse(request: Request, body: string, lastModified: Date, headers: Record<string, string>) {
  const etag = etagOf(body), shared = {ETag: etag, 'Last-Modified': lastModified.toUTCString(), ...headers};
  if (notModified(request, etag, lastModified)) return new Response(null, {status: 304, headers: shared});
  return new Response(body, {headers: {'Content-Type': 'text/calendar; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...shared}});
}
