import {apiError} from '../../../../lib/api';
import {bboxEvents, serializeEvents} from '../../../../lib/geo/nearby';
import {bboxSchema, queryObject} from '../../../../lib/geo/params';
// Published events inside the map viewport: ?bbox=west,south,east,north&from=&to=&style=
export async function GET(request: Request) {
  try {
    const events = await bboxEvents(bboxSchema.parse(queryObject(request)));
    return Response.json({events: serializeEvents(events)}, {headers: {'Cache-Control': 'public, max-age=30'}});
  } catch (error) { return apiError(error); }
}
