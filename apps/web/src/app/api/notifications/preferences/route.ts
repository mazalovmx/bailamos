import {actor, apiError, ApiError, jsonBody, viewer} from '../../../../lib/api';
import {getPreferences, preferencesSchema, savePreferences} from '../../../../lib/notifications/center';
const privately = {headers: {'Cache-Control': 'private, no-store'}};
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json(await getPreferences(user.id), privately);
  } catch (error) {return apiError(error);}
}
// Partial update: only the switches present in the body change.
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    return Response.json(await savePreferences(user.id, preferencesSchema.parse(await jsonBody(request))), privately);
  } catch (error) {return apiError(error);}
}
