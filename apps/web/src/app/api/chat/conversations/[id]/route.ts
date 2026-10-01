import {z} from 'zod';
import {apiError, jsonBody} from '../../../../../lib/api';
import {chatActor, chatViewer, noStore} from '../../../../../lib/chat/http';
import {acceptConversation, conversationDetail, leaveConversation, markRead, renameConversation} from '../../../../../lib/chat/service';
type Context = {params: Promise<{id: string}>};
// {action: 'rename', title} renames a group; only its admins (the school, in a school's conversation) may.
const actionInput = z.object({action: z.enum(['accept', 'read', 'rename']), title: z.string().max(400).optional()});
export async function GET(request: Request, {params}: Context) {
  try {
    const me = await chatViewer(request);
    return Response.json(await conversationDetail(me, (await params).id), {headers: noStore});
  } catch (error) {return apiError(error);}
}
export async function PATCH(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request), {id} = await params;
    const {action, title} = actionInput.parse(await jsonBody(request));
    if (action === 'accept') await acceptConversation(me, id);
    else if (action === 'rename') await renameConversation(me, id, {title});
    else await markRead(me, id);
    return Response.json({ok: true});
  } catch (error) {return apiError(error);}
}
// Leaves the conversation; for a direct request this is "decline".
export async function DELETE(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request);
    await leaveConversation(me, (await params).id);
    return Response.json({ok: true});
  } catch (error) {return apiError(error);}
}
