import {apiError} from '../../../../lib/api';
import {locate} from '../../../../lib/geo/locate';
import {locateSchema, queryObject} from '../../../../lib/geo/params';
// Picks the visitor's city. With ?lat=&lng= (browser geolocation, sent only on an explicit "near me") it returns the nearest city;
// otherwise the `city` cookie, then proxy/CDN geo headers, then the default city. Coordinates are neither logged nor stored.
export async function GET(request: Request) {
  try {
    const {lat, lng} = locateSchema.parse(queryObject(request));
    const location = await locate(request.headers, lat !== undefined && lng !== undefined ? {lat, lng} : undefined);
    return Response.json(location, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) { return apiError(error); }
}
