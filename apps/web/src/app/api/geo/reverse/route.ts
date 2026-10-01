import {apiError, ApiError, viewer} from '../../../../lib/api';
import {reverseGeocode} from '../../../../lib/geo/geocode';
import {queryObject, reverseSchema} from '../../../../lib/geo/params';
import {rateLimit} from '../../../../lib/geo/rate-limit';
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    const {lat, lng, lang} = reverseSchema.parse(queryObject(request));
    if (!await rateLimit('reverse:' + user.id, 30, 60)) throw new ApiError('RATE_LIMITED', 429);
    return Response.json({result: await reverseGeocode(lat, lng, {lang})}, {headers: {'Cache-Control': 'private, max-age=300'}});
  } catch (error) { return apiError(error); }
}
