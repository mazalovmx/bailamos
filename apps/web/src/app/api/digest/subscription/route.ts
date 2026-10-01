import {z} from 'zod';
import {actor, apiError, ApiError, jsonBody, viewer} from '../../../../lib/api';
import {digestSubscription, setDigestSubscription} from '../../../../lib/digest/send';
import {CONSENT_DIGEST, logConsent} from '../../../../lib/account/consent';
const input = z.strictObject({enabled: z.boolean()});
// The weekly digest is opt-in: nothing is sent until the account itself sends {enabled: true}.
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json(await digestSubscription(user.id), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
// Every real change of the answer is recorded in the consent log; saving the same answer again adds nothing.
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    const {enabled} = input.parse(await jsonBody(request)), before = await digestSubscription(user.id);
    const result = await setDigestSubscription(user.id, enabled);
    if (before.enabled !== enabled) await logConsent(user.id, CONSENT_DIGEST, enabled);
    return Response.json(result);
  } catch (error) {return apiError(error);}
}
