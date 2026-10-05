import {apiError, viewer} from '../../../../lib/api';
import {chatViewer, noStore} from '../../../../lib/chat/http';
import {unreadCounts} from '../../../../lib/chat/service';
export async function GET(request: Request) {
  try {
    // Before the profile exists there is nothing to count; answering 409 filled the console on every page.
    const user = await viewer(request);
    if (user && !user.bannedAt && !user.profile) return Response.json({total: 0, conversations: 0, requests: 0}, {headers: noStore});
    return Response.json(await unreadCounts(await chatViewer(request)), {headers: noStore});
  } catch (error) {return apiError(error);}
}
