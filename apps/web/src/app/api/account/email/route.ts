import {z} from 'zod';
import {actor, apiError, ApiError, jsonBody} from '../../../../lib/api';
import {rateLimit} from '../../../../lib/rate-limit';
import {confirmIdentity} from '../../../../lib/account/confirm';
import {requestEmailChange} from '../../../../lib/account/email-change';
const input = z.strictObject({newEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()), password: z.string().min(1).max(128).optional()});
// POST /api/account/email — asks to change the sign-in email. The password (or, without one, a sign-in within the last
// 10 minutes) is required; the new address must open the mailed link before anything changes, and the old one is told.
// Every attempt counts towards five per hour, so the form cannot be used to guess the password or to flood a mailbox.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const body = input.parse(await jsonBody(request));
    const limit = await rateLimit('change-email:' + user.id, {limit: 5, windowSec: 3600});
    if (!limit.ok) return Response.json({error: 'TOO_MANY_REQUESTS'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter)}});
    if (body.newEmail === user.email.toLowerCase()) throw new ApiError('SAME_EMAIL', 400);
    await confirmIdentity(request, user.id, body.password);
    await requestEmailChange(request.headers, user, body.newEmail);
    console.info(JSON.stringify({level: 'info', event: 'email_change_requested'}));
    return Response.json({sent: true}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return apiError(error);}
}
