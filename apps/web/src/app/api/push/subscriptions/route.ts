import {actor, apiError, ApiError, jsonBody} from '../../../../lib/api';
import {allowedEndpoint, endpointSchema, pushEnabled, removeSubscription, saveSubscription, subscriptionSchema} from '../../../../lib/notifications/push';
const privately = {headers: {'Cache-Control': 'private, no-store'}};
// Body: PushSubscription.toJSON() of this browser.
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    if (!pushEnabled()) throw new ApiError('PUSH_UNAVAILABLE', 503);
    const input = subscriptionSchema.parse(await jsonBody(request));
    if (!allowedEndpoint(input.endpoint)) throw new ApiError('INVALID_SUBSCRIPTION', 400);
    await saveSubscription(user.id, input);
    return Response.json({subscribed: true}, privately);
  } catch (error) {return apiError(error);}
}
export async function DELETE(request: Request) {
  try {
    const user = await actor(request);
    const {endpoint} = endpointSchema.parse(await jsonBody(request));
    return Response.json({subscribed: false, removed: await removeSubscription(user.id, endpoint)}, privately);
  } catch (error) {return apiError(error);}
}
