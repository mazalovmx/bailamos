import {ApiError, apiError} from '../../../../lib/api';
import {rateLimit} from '../../../../lib/rate-limit';
import {chatViewer} from '../../../../lib/chat/http';
import {limits} from '../../../../lib/chat/policy';
import {chatStream} from '../../../../lib/chat/stream';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Live chat events over Server-Sent Events. 503 REALTIME_UNAVAILABLE tells the client to poll instead.
export async function GET(request: Request) {
  try {
    const me = await chatViewer(request);
    if (!(await rateLimit('chat:stream:' + me.userId, limits.stream)).ok) throw new ApiError('RATE_LIMITED', 429);
    const headers = new Headers(request.headers);
    const stillAllowed = () => chatViewer(new Request(request.url, {headers})).then(next => next.profileId === me.profileId, () => false);
    return await chatStream(me, request.signal, stillAllowed) ?? Response.json({error: 'REALTIME_UNAVAILABLE'}, {status: 503});
  } catch (error) {return apiError(error);}
}
