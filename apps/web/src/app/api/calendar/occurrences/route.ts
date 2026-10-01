import {apiError} from '../../../../lib/api';
import {calendarFilters, findOccurrences, rangeSchema} from '../../../../lib/calendar/query';
// Public calendar data: materialized occurrences of published, visible events inside a capped window.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const range = rangeSchema.parse({from: params.get('from') ?? '', to: params.get('to') ?? ''});
    return Response.json(await findOccurrences(range, calendarFilters(params)), {headers: {'Cache-Control': 'public, max-age=60'}});
  } catch (error) { return apiError(error); }
}
