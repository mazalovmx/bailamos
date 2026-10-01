import {actor, apiError, jsonBody} from '../../../../lib/api';
import {markRead, readSchema} from '../../../../lib/notifications/center';
// Body: {"id": "…"} or {"ids": ["…"]} or {"all": true}. Only the caller's own notifications are touched.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    return Response.json(await markRead(user.id, readSchema.parse(await jsonBody(request))), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
