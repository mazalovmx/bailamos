import {apiError, jsonBody} from '../../../../../../lib/api';
import {chatActor, chatViewer, noStore} from '../../../../../../lib/chat/http';
import {listMessages, messageInput, sendMessage} from '../../../../../../lib/chat/service';
type Context = {params: Promise<{id: string}>};
// ?before=<messageId> pages backwards through history, ?after=<messageId> returns what arrived since, and
// ?from=<messageId> re-reads forwards starting with that message (how a client without the live stream notices edits, deletions and hiding).
export async function GET(request: Request, {params}: Context) {
  try {
    const me = await chatViewer(request), query = new URL(request.url).searchParams;
    const page = await listMessages(me, (await params).id,
      {before: query.get('before') ?? undefined, after: query.get('after') ?? undefined, from: query.get('from') ?? undefined, limit: query.get('limit') ?? undefined});
    return Response.json(page, {headers: noStore});
  } catch (error) {return apiError(error);}
}
export async function POST(request: Request, {params}: Context) {
  try {
    const me = await chatActor(request);
    // {body, attachmentKey?}: the key is what the media upload (target "chat", targetId = this conversation) returned.
    const {body, attachmentKey} = messageInput.parse(await jsonBody(request));
    return Response.json({message: await sendMessage(me, (await params).id, body, attachmentKey)}, {status: 201});
  } catch (error) {return apiError(error);}
}
