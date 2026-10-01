import {z} from 'zod';
import {apiError, jsonBody} from '../../../../../lib/api';
import {chatActor} from '../../../../../lib/chat/http';
import {setMessageHidden} from '../../../../../lib/chat/service';
const input = z.object({hidden: z.boolean()});
// Room admins hide or restore a message. Everybody else reports it through /api/reports (targetType MESSAGE).
export async function PATCH(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const me = await chatActor(request);
    return Response.json(await setMessageHidden(me, (await params).id, input.parse(await jsonBody(request)).hidden));
  } catch (error) {return apiError(error);}
}
