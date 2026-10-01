import {db} from '@dance/db';
import {apiError, ApiError} from '../../../../../../lib/api';
import {managedEvent} from '../../../../../../lib/events/access';
import {eventAbility} from '../../../../../../lib/permissions';
// Removes a co-organizer. The owner may remove anyone; a co-organizer may only step down themselves.
// The owner's own membership cannot be removed: an event always has an owner.
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;profileId:string}>}) {
  try {
    const {id,profileId}=await params;
    const {profile,event}=await managedEvent(request,id);
    if (profileId!==profile.id&&!eventAbility(profile.id,event.members).can('team','Event')) throw new ApiError('FORBIDDEN',403);
    const removed=await db.eventMembership.deleteMany({where:{eventId:id,profileId,role:'CO_ORGANIZER'}});
    if (!removed.count) throw new ApiError('NOT_FOUND',404);
    return Response.json({removed:true});
  } catch(error) {return apiError(error);}
}
