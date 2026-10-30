import {inZone} from './time';
type Instant = Date | string;
export type LinkEvent = {title: string; timezone: string; location?: string | null; details?: string | null; url?: string | null};
export type LinkOccurrence = {startsAt: Instant; endsAt?: Instant | null};
const stamp = (value: Instant, zone: string) => inZone(value, zone).toFormat("yyyyMMdd'T'HHmmss");
// Google Calendar "create event" template. Dates are the event's wall-clock time and `ctz` names the zone, so the
// entry keeps the event's local hour whatever the visitor's own zone is. Without an end time Google needs one: +1 hour.
export function googleCalendarUrl(event: LinkEvent, occurrence: LinkOccurrence) {
  const end = occurrence.endsAt || inZone(occurrence.startsAt, 'UTC').plus({hours: 1}).toJSDate();
  const details = [event.details?.trim().slice(0, 1500), event.url].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({action: 'TEMPLATE', text: event.title,
    dates: stamp(occurrence.startsAt, event.timezone) + '/' + stamp(end, event.timezone), ctz: event.timezone});
  if (details) params.set('details', details);
  if (event.location) params.set('location', event.location);
  return 'https://calendar.google.com/calendar/render?' + params;
}
// Outlook (personal: outlook.live.com, work or school: outlook.office.com) and Yahoo take UTC instants, not a zone.
const utc = (value: Instant) => inZone(value, 'UTC');
const endOf = (occurrence: LinkOccurrence) => occurrence.endsAt || utc(occurrence.startsAt).plus({hours: 1}).toJSDate();
const detailsOf = (event: LinkEvent) => [event.details?.trim().slice(0, 1500), event.url].filter(Boolean).join('\n\n');
export function outlookCalendarUrl(event: LinkEvent, occurrence: LinkOccurrence, host: 'live' | 'office' = 'live') {
  const iso = (value: Instant) => utc(value).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
  const params = new URLSearchParams({path: '/calendar/action/compose', rru: 'addevent', subject: event.title,
    startdt: iso(occurrence.startsAt), enddt: iso(endOf(occurrence))});
  const details = detailsOf(event);
  if (details) params.set('body', details);
  if (event.location) params.set('location', event.location);
  return 'https://outlook.' + host + '.com/calendar/0/action/compose?' + params;
}
export function yahooCalendarUrl(event: LinkEvent, occurrence: LinkOccurrence) {
  const stampUtc = (value: Instant) => utc(value).toFormat("yyyyMMdd'T'HHmmss'Z'");
  const params = new URLSearchParams({v: '60', title: event.title, st: stampUtc(occurrence.startsAt), et: stampUtc(endOf(occurrence))});
  const details = detailsOf(event);
  if (details) params.set('desc', details);
  if (event.location) params.set('in_loc', event.location);
  return 'https://calendar.yahoo.com/?' + params;
}
export function icsUrl(eventId: string) { return '/api/events/' + encodeURIComponent(eventId) + '/ics'; }
// Site origin used in feed URLs, event links and iCal UIDs.
export function siteOrigin() { return new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin; }
export function feedPath(filter: {citySlug?: string | null; styleSlug?: string | null; locale?: string}) {
  const params = new URLSearchParams();
  if (filter.citySlug) params.set('city', filter.citySlug);
  if (filter.styleSlug) params.set('style', filter.styleSlug);
  if (filter.locale && filter.locale !== 'en') params.set('locale', filter.locale);
  const query = params.toString();
  return '/api/feeds/ical' + (query ? '?' + query : '');
}
