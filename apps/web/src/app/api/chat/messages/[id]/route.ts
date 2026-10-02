import {z} from 'zod';
import {apiError, jsonBody} from '../../../../../lib/api';
import {chatActor} from '../../../../../lib/chat/http';
import {deleteMessage, editMessage, setMessageHidden} from '../../../../../lib/chat/service';
type Context = {params: Promise<{id: string}>};
const input = z.union([z.object({hidden: z.boolean()}).strict(), z.object({body: z.string().max(8000)}).strict()]);
// {hidden}: room admins hide or restore a message; everybody else reports it through /api/reports (targetType MESSAGE).
// {body}: the author corrects their own message within the edit window.
export async function PATCH(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request), {id} = await params, data = input.parse(await jsonBody(request));
    return Response.json('hidden' in data ? await setMessageHidden(me, id, data.hidden) : {message: await editMessage(me, id, data.body)});
  } catch (error) {return apiError(error);}
}
// The author deletes their own message: text and image are erased, a placeholder stays.
export async function DELETE(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request);
    return Response.json(await deleteMessage(me, (await params).id));
  } catch (error) {return apiError(error);}
}
