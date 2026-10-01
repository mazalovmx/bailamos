import {actor, apiError, ApiError, viewer} from '../../../../lib/api';
import {rateLimit} from '../../../../lib/rate-limit';
import {botConfig} from '../../../../lib/telegram/api';
import {createLinkToken, linkStatus, unlinkUser} from '../../../../lib/telegram/link';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'no-store'};
// Whether the bot exists on this installation and whether the signed-in user has a chat connected.
export async function GET(request: Request) {
  try {
    const config = botConfig(), user = await viewer(request);
    if (!config?.username) return Response.json({enabled: false, linked: false, notify: false}, {headers});
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json({enabled: true, ...(await linkStatus(user.id))}, {headers});
  } catch (error) {return apiError(error);}
}
// A one-time deep link: opening it starts the bot with the token and connects that chat to the account.
export async function POST(request: Request) {
  try {
    if (!botConfig()?.username) throw new ApiError('NOT_FOUND', 404);
    const user = await actor(request);
    const limit = await rateLimit('telegram-link:' + user.id, {limit: 5, windowSec: 600});
    if (!limit.ok) return Response.json({error: 'RATE_LIMITED'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter)}});
    const created = await createLinkToken(user.id);
    if (!created) throw new ApiError('NOT_FOUND', 404);
    return Response.json({url: created.url, expiresAt: created.expiresAt.toISOString()}, {status: 201, headers});
  } catch (error) {return apiError(error);}
}
export async function DELETE(request: Request) {
  try {
    if (!botConfig()) throw new ApiError('NOT_FOUND', 404);
    const user = await actor(request);
    return Response.json({unlinked: await unlinkUser(user.id)}, {headers});
  } catch (error) {return apiError(error);}
}
