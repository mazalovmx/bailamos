import {db} from '@dance/db';
import {apiError, ApiError, viewer} from '../../../../lib/api';
import {autocompleteAvailable, search, suggest} from '../../../../lib/geo/geocode';
import {queryObject, searchSchema} from '../../../../lib/geo/params';
import {rateLimit} from '../../../../lib/geo/rate-limit';
// Address search and autocomplete for signed-in users; the limits protect the upstream geocoder.
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    const {q, cityId, lang, mode} = searchSchema.parse(queryObject(request));
    if (!await rateLimit((mode === 'suggest' ? 'suggest:' : 'search:') + user.id, mode === 'suggest' ? 60 : 20, 60)) throw new ApiError('RATE_LIMITED', 429);
    const city = cityId ? await db.city.findUnique({where: {id: cityId}, select: {name: true, countryCode: true, lat: true, lng: true}}) : null;
    const results = mode === 'suggest'
      ? await suggest(q, {countryCode: city?.countryCode, lang, near: city || undefined})
      : await search(city ? q + ', ' + city.name : q, {countryCode: city?.countryCode, lang});
    return Response.json({results, autocomplete: autocompleteAvailable()}, {headers: {'Cache-Control': 'private, max-age=300'}});
  } catch (error) { return apiError(error); }
}
