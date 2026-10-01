import {apiError, ApiError, viewer} from '../../../lib/api';
import {cursorSchema, listNotifications, unreadCount} from '../../../lib/notifications/center';
const privately = {headers: {'Cache-Control': 'private, no-store'}};
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    const query = new URL(request.url).searchParams, account = user as {locale?: string | null};
    // The page asks in its own interface language; other clients get the account language.
    const locale = query.get('locale') || account.locale || 'en';
    const [page, unread] = await Promise.all([listNotifications(user.id, locale, cursorSchema.parse(query.get('cursor') || undefined)), unreadCount(user.id)]);
    return Response.json({...page, unread}, privately);
  } catch (error) {return apiError(error);}
}
