import {apiError, jsonBody} from '../../../../lib/api';
import {chatActor, chatViewer, noStore} from '../../../../lib/chat/http';
import {createGroup, inbox} from '../../../../lib/chat/service';
export async function GET(request: Request) {
  try {return Response.json(await inbox(await chatViewer(request)), {headers: noStore});} catch (error) {return apiError(error);}
}
// Creates a group conversation: {title, handles?}. Handles that cannot be invited are skipped and counted.
export async function POST(request: Request) {
  try {
    const me = await chatActor(request);
    return Response.json(await createGroup(me, await jsonBody(request)), {status: 201});
  } catch (error) {return apiError(error);}
}
