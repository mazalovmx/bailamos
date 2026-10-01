import {apiError, jsonBody} from '../../../../lib/api';
import {chatActor} from '../../../../lib/chat/http';
import {joinRoom, roomInput} from '../../../../lib/chat/service';
// Joins the room of an event ({eventId}) or of a city ({cityId}); the room itself is created on first use.
export async function POST(request: Request) {
  try {
    const me = await chatActor(request);
    return Response.json(await joinRoom(me, roomInput.parse(await jsonBody(request))));
  } catch (error) {return apiError(error);}
}
