import {z} from 'zod';
import {actor, apiError, ApiError, jsonBody, viewer} from '../../../../lib/api';
import {digestSubscription, setDigestSubscription} from '../../../../lib/digest/send';
const input = z.strictObject({enabled: z.boolean()});
// The weekly digest is opt-in: nothing is sent until the account itself sends {enabled: true}.
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json(await digestSubscription(user.id), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    return Response.json(await setDigestSubscription(user.id, input.parse(await jsonBody(request)).enabled));
  } catch (error) {return apiError(error);}
}
