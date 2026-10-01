import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {haversine} from '../../../lib/geo/coarsen';
import {geocode, reverseGeocode} from '../../../lib/geo/geocode';
import {queryObject, venueListSchema, venueSchema} from '../../../lib/geo/params';
import {rateLimit} from '../../../lib/geo/rate-limit';
const select = {id: true, name: true, address: true, cityId: true, lat: true, lng: true} as const;
export async function GET(request: Request) {
  try {
    const {cityId, q} = venueListSchema.parse(queryObject(request));
    const venues = await db.venue.findMany({
      where: {hiddenAt: null, ...(cityId ? {cityId} : {}), ...(q ? {OR: [{name: {contains: q, mode: 'insensitive'}}, {address: {contains: q, mode: 'insensitive'}}]} : {})},
      orderBy: [{name: 'asc'}, {id: 'asc'}], take: 100, select
    });
    return Response.json({venues});
  } catch (error) { return apiError(error); }
}
// Coordinates are geocoded from the address when omitted; the address is reverse-geocoded when only coordinates are given.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const input = venueSchema.parse(await jsonBody(request));
    const city = await db.city.findUnique({where: {id: input.cityId}});
    if (!city) throw new ApiError('CITY_NOT_FOUND', 400);
    if (!await rateLimit('venue:' + user.id, 20, 86400)) throw new ApiError('RATE_LIMITED', 429);
    let point = input.lat !== undefined && input.lng !== undefined ? {lat: input.lat, lng: input.lng} : null;
    let address = input.address, addressSuggested = false;
    if (!point) {
      const found = await geocode(address + ', ' + city.name, {countryCode: city.countryCode, lang: input.lang});
      if (!found) throw new ApiError('ADDRESS_NOT_FOUND', 422);
      point = {lat: found.lat, lng: found.lng};
    } else if (!address) {
      address = (await reverseGeocode(point.lat, point.lng, {lang: input.lang}))?.label;
      if (!address) throw new ApiError('ADDRESS_REQUIRED', 422);
      addressSuggested = true;
    }
    const place = point;
    if (!address) throw new ApiError('ADDRESS_REQUIRED', 422);
    if (haversine(place, city) > 150000) throw new ApiError('VENUE_TOO_FAR', 422);
    // The same place submitted twice resolves to the existing venue.
    const twin = (await db.venue.findMany({where: {cityId: city.id, hiddenAt: null, name: {equals: input.name, mode: 'insensitive'}}, select}))
      .find(venue => haversine(venue, place) < 150);
    if (twin) return Response.json({venue: twin, existing: true, addressSuggested: false});
    const venue = await db.venue.create({data: {name: input.name, address, cityId: city.id, ...place}, select});
    return Response.json({venue, existing: false, addressSuggested}, {status: 201});
  } catch (error) { return apiError(error); }
}
