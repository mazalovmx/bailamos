import {apiError, ApiError} from '../../../../../lib/api';
import {buildCalendar, calendarResponse} from '../../../../../lib/calendar/ics';
import {findIcsEvent} from '../../../../../lib/calendar/query';
import {feedLocale} from '../../../../../lib/calendar/feed-name';
import {siteOrigin} from '../../../../../lib/calendar/links';
export const dynamic = 'force-dynamic';
// .ics download of one event; [id] is the event id or its slug. Drafts and hidden events answer 404.
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params;
    const event = id.length <= 200 ? await findIcsEvent(id) : null;
    if (!event) throw new ApiError('NOT_FOUND', 404);
    const body = buildCalendar({name: event.title, origin: siteOrigin(), locale: feedLocale(new URL(request.url).searchParams.get('locale')), events: [event], timezone: event.timezone});
    return calendarResponse(request, body, event.updatedAt, {'Cache-Control': 'public, max-age=300',
      'Content-Disposition': 'attachment; filename="' + event.slug.replace(/[^a-z0-9_-]/gi, '-') + '.ics"'});
  } catch (error) { return apiError(error); }
}
