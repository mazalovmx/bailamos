import {apiError, ApiError} from '../../../../lib/api';
import {allCities, allStyles} from '../../../../lib/catalogue/data';
import {parseDayPart, parseLevels, parseWeekdays, styleFilter, weekOf, weekTimetable} from '../../../../lib/courses/timetable';
import {findSchool} from '../../../../lib/courses/schools';
// GET /api/courses/timetable?city=&style=&level=&week=&weekday=&time=&school=
// city: slug or id · style: slug or id (sub-styles included) · level: comma-separated EventLevel values
// week: "2030-06-12" (any day of the week) or "2030-W24" · weekday: 1…7, comma-separated · time: morning | afternoon | evening
// school: profile handle. Public data only, so the response may be cached briefly.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, text = (key: string) => (params.get(key) || '').trim().slice(0, 80);
    const [cities, styles] = await Promise.all([allCities(), allStyles()]);
    const city = text('city') ? cities.find(item => item.slug === text('city') || item.id === text('city')) : null;
    if (text('city') && !city) throw new ApiError('NOT_FOUND', 404);
    const school = text('school') ? await findSchool(text('school')) : null;
    if (text('school') && !school) throw new ApiError('NOT_FOUND', 404);
    const timetable = await weekTimetable(weekOf(text('week'), city?.timezone || school?.city?.timezone || 'UTC'), {cityId: city?.id,
      styleIds: styleFilter(styles, text('style')) ?? (text('style') ? [] : undefined), levels: parseLevels(params.get('level')),
      weekdays: parseWeekdays(params.get('weekday')), dayPart: parseDayPart(params.get('time')), profileId: school?.id});
    return Response.json({city: city ? {slug: city.slug, name: city.name, timezone: city.timezone} : null, ...timetable},
      {headers: {'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'}});
  } catch (error) {return apiError(error);}
}
