import {apiError, jsonBody} from '../../../../../lib/api';
import {managedEvent} from '../../../../../lib/events/access';
import {artistInput} from '../../../../../lib/events/schema';
import {attachArtist} from '../../../../../lib/events/artists';
// Attaches an artist: {handle} for an existing profile, {name,type} to create a profile without an owner.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {id}=await params;
    const {event}=await managedEvent(request,id);
    return Response.json(await attachArtist(event,artistInput.parse(await jsonBody(request))),{status:201});
  } catch(error) {return apiError(error);}
}
