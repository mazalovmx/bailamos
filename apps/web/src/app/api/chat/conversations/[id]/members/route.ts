import {apiError, jsonBody} from '../../../../../../lib/api';
import {chatActor} from '../../../../../../lib/chat/http';
import {inviteMember, leaveConversation, removeInput} from '../../../../../../lib/chat/service';
type Context = {params: Promise<{id: string}>};
// Group admins invite by handle: {handle}.
export async function POST(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request);
    return Response.json(await inviteMember(me, (await params).id, await jsonBody(request)), {status: 201});
  } catch (error) {return apiError(error);}
}
// {profileId} removes a member (group admins only); without it the caller leaves.
export async function DELETE(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request);
    const {profileId} = removeInput.parse(await jsonBody(request));
    await leaveConversation(me, (await params).id, profileId);
    return Response.json({ok: true});
  } catch (error) {return apiError(error);}
}
