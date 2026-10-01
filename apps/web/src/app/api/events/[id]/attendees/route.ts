import {db} from '@dance/db';
import {apiError, ApiError, viewer} from '../../../../../lib/api';
import {eventAbility} from '../../../../../lib/permissions';
import {isPublic} from '../../../../../lib/events/access';
import {listAttendees} from '../../../../../lib/events/attendees';
// Counters for everyone; names according to Event.attendeeVisibility (PUBLIC, ATTENDEES, ORGANIZERS).
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {id}=await params,user=await viewer(request);
    const event=await db.event.findUnique({where:{id},select:{id:true,status:true,hiddenAt:true,attendeeVisibility:true,members:{select:{profileId:true,role:true}}}});
    if (!event || (!isPublic(event) && !eventAbility(user?.profile?.id,event.members).can('manage','Event'))) throw new ApiError('NOT_FOUND',404);
    const {going,interested,visible,visibility,attendees}=await listAttendees(event,user?.profile?.id);
    return Response.json({going,interested,visible,visibility,attendees},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
