import {apiError} from '../../../../lib/api';
import {nearbyEvents, serializeEvents} from '../../../../lib/geo/nearby';
import {nearbySchema, queryObject} from '../../../../lib/geo/params';
// Published events within a radius, nearest first: ?lat=&lng=&radiusKm=&style=&from=&to=&limit=
export async function GET(request: Request) {
  try {
    const events = await nearbyEvents(nearbySchema.parse(queryObject(request)));
    return Response.json({events: serializeEvents(events)}, {headers: {'Cache-Control': 'public, max-age=30'}});
  } catch (error) { return apiError(error); }
}
