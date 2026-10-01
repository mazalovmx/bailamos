import {actor, apiError, ApiError, jsonBody, viewer} from '../../../lib/api';
import {follow, followTarget, followsOf, unfollow} from '../../../lib/catalogue/follows';
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json(await followsOf(user.id), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    return Response.json(await follow(user, followTarget.parse(await jsonBody(request))));
  } catch (error) {return apiError(error);}
}
export async function DELETE(request: Request) {
  try {
    const user = await actor(request);
    return Response.json(await unfollow(user.id, followTarget.parse(await jsonBody(request))));
  } catch (error) {return apiError(error);}
}
