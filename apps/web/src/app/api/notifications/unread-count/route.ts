import {apiError, ApiError, viewer} from '../../../../lib/api';
import {unreadCount} from '../../../../lib/notifications/center';
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json({count: await unreadCount(user.id)}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
