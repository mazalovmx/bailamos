import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../../../lib/api';
import {rsvpInput} from '../../../../../lib/events/schema';
import {setRsvp} from '../../../../../lib/events/attendees';
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const {id}=await params;
    const {status}=rsvpInput.parse(await jsonBody(request));
    const event=await db.event.findUnique({where:{id},include:{occurrences:{where:{startsAt:{gte:new Date()},cancelled:false},take:1}}});
    if (!event || event.status!=='PUBLISHED' || event.hiddenAt || !event.occurrences.length) throw new ApiError('EVENT_UNAVAILABLE',400);
    await setRsvp(event,user.profile,status);
    const [going,interested]=await Promise.all((['GOING','INTERESTED'] as const).map(s=>db.rsvp.count({where:{eventId:id,status:s}})));
    return Response.json({status,going,interested});
  } catch(error) {return apiError(error);}
}
