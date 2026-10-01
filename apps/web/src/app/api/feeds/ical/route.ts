import {apiError} from '../../../../lib/api';
import {buildCalendar, calendarResponse} from '../../../../lib/calendar/ics';
import {calendarFilters, filterNames, findFeedEvents} from '../../../../lib/calendar/query';
import {feedLocale, feedName} from '../../../../lib/calendar/feed-name';
import {siteOrigin} from '../../../../lib/calendar/links';
export const dynamic = 'force-dynamic';
const TTL = 3600;
// Subscribable calendar: ?city=<slug>&style=<slug> (either, both or neither; repeatable). Clients poll this URL,
// so validators (ETag, Last-Modified) and a refresh hint matter more than anything else here.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, locale = feedLocale(params.get('locale'));
    const filters = {...calendarFilters(params), level: [], kind: []};
    const [events, names] = await Promise.all([findFeedEvents(filters), filterNames(filters)]);
    const zones = [...new Set(names.cities.map(c => c.timezone))];
    const body = buildCalendar({name: feedName(locale, [...names.cities, ...names.styles].map(n => n.name)), origin: siteOrigin(), locale, events,
      ttlSeconds: TTL, timezone: zones.length === 1 ? zones[0] : null});
    // Last-Modified is the newest event change. It cannot see a removed event, which is why the ETag (a hash of
    // the whole body) is the validator that decides whenever the client sends If-None-Match.
    const lastModified = new Date(Math.max(0, ...events.map(e => e.updatedAt.getTime())));
    return calendarResponse(request, body, lastModified, {'Cache-Control': 'public, max-age=' + TTL, 'Content-Disposition': 'inline; filename="dance-events.ics"'});
  } catch (error) { return apiError(error); }
}
