import {db} from '@dance/db';
import {apiError, ApiError} from '../../../../lib/api';
import {clientIp, rateLimit} from '../../../../lib/rate-limit';
import {setDigestSubscription} from '../../../../lib/digest/send';
import {verifyUnsubscribeToken} from '../../../../lib/digest/token';
import {CONSENT_DIGEST, logConsent} from '../../../../lib/account/consent';
// POST /api/digest/unsubscribe — switches the weekly digest off for the account named by a signed token.
// The token is the credential: no session and no Origin are required, because mail clients call this URL directly
// (RFC 8058 one-click: POST <List-Unsubscribe URL> with the token in the query). The confirmation page posts JSON {token}.
// Deliberately no GET: link scanners and prefetchers must not unsubscribe anyone.
export async function POST(request: Request) {
  try {
    const limit = await rateLimit('digest-unsubscribe:' + clientIp(request), {limit: 30, windowSec: 60});
    if (!limit.ok) return Response.json({error: 'TOO_MANY_REQUESTS'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter)}});
    let token = new URL(request.url).searchParams.get('token');
    if (!token) {
      const text = await request.text();
      if (text.length > 2000) throw new ApiError('INVALID_INPUT', 413);
      if ((request.headers.get('content-type') || '').includes('json')) {
        try {
          const body: unknown = JSON.parse(text);
          token = body && typeof body === 'object' && typeof (body as {token?: unknown}).token === 'string' ? (body as {token: string}).token : null;
        } catch {throw new ApiError('INVALID_INPUT', 400);}
      } else token = new URLSearchParams(text).get('token');
    }
    const userId = verifyUnsubscribeToken(token);
    if (!userId) throw new ApiError('INVALID_TOKEN', 400);
    // A deleted account has nothing to switch off; the answer is the same so the token reveals nothing.
    if (await db.user.findUnique({where: {id: userId}, select: {id: true}})) {
      await setDigestSubscription(userId, false);
      await logConsent(userId, CONSENT_DIGEST, false);
    }
    console.log(JSON.stringify({level: 'info', event: 'digest_unsubscribed'}));
    return Response.json({enabled: false}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return apiError(error);}
}
