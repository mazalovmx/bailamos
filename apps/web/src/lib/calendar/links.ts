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
