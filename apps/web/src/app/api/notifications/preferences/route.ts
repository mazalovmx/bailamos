import {actor, apiError, ApiError, jsonBody, viewer} from '../../../../lib/api';
import {getPreferences, preferencesSchema, savePreferences} from '../../../../lib/notifications/center';
import {CONSENT_DIGEST, logConsent} from '../../../../lib/account/consent';
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
    const input = preferencesSchema.parse(await jsonBody(request)), saved = await savePreferences(user.id, input);
    // The weekly digest is an opt-in: each real change of the answer goes to the consent log.
    if (typeof input.emailDigest === 'boolean') await logConsent(user.id, CONSENT_DIGEST, input.emailDigest);
    return Response.json(saved, privately);
  } catch (error) {return apiError(error);}
}
