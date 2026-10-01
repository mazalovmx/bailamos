import {apiError, jsonBody} from '../../../../../../lib/api';
import {chatActor, chatViewer, noStore} from '../../../../../../lib/chat/http';
import {listMessages, messageInput, sendMessage} from '../../../../../../lib/chat/service';
type Context = {params: Promise<{id: string}>};
// ?before=<messageId> pages backwards through history, ?after=<messageId> returns what arrived since (the polling fallback).
export async function GET(request: Request, {params}: Context) {
  try {
    const me = await chatViewer(request), query = new URL(request.url).searchParams;
    const page = await listMessages(me, (await params).id,
      {before: query.get('before') ?? undefined, after: query.get('after') ?? undefined, limit: query.get('limit') ?? undefined});
    return Response.json(page, {headers: noStore});
  } catch (error) {return apiError(error);}
}
export async function POST(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request);
    const {body} = messageInput.parse(await jsonBody(request));
    return Response.json({message: await sendMessage(me, (await params).id, body)}, {status: 201});
  } catch (error) {return apiError(error);}
}
