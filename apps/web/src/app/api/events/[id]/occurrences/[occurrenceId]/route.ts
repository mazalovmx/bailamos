import {db} from '@dance/db';
import {apiError, ApiError, jsonBody} from '../../../../../../lib/api';
import {managedEvent} from '../../../../../../lib/events/access';
import {occurrenceInput} from '../../../../../../lib/events/schema';
import {announceCancellation} from '../../../../../../lib/events/cancel';
import {announceMove, moveOccurrence} from '../../../../../../lib/events/move';
// One date of a series; the other dates are untouched.
//   {cancelled}             cancels or restores the date;
//   {startsLocal,endsLocal} moves it to new wall-clock times in the event's time zone.
export async function PATCH(request:Request,{params}:{params:Promise<{id:string;occurrenceId:string}>}) {
  try {
    const {id,occurrenceId}=await params;
    const {event,user}=await managedEvent(request,id);
    const body=occurrenceInput.parse(await jsonBody(request));
    const live=event.status==='PUBLISHED'&&!event.hiddenAt;
    if ('startsLocal' in body) {
      const {changed,previous,occurrence}=await moveOccurrence(event,occurrenceId,body);
      // Told once per real change; the organizer who made it is not told.
      if (changed&&live) await announceMove(id,occurrence,previous.startsAt,{exceptUserId:user.id});
      return Response.json({id:occurrence.id,startsAt:occurrence.startsAt,endsAt:occurrence.endsAt,originalStartsAt:occurrence.originalStartsAt,cancelled:occurrence.cancelled});
    }
    const {cancelled}=body;
    // The conditional update makes the transition, and so the announcement, happen exactly once.
    const changed=await db.eventOccurrence.updateMany({where:{id:occurrenceId,eventId:id,cancelled:!cancelled},data:{cancelled}});
    const occurrence=await db.eventOccurrence.findFirst({where:{id:occurrenceId,eventId:id}});
    if (!occurrence) throw new ApiError('NOT_FOUND',404);
    if (changed.count&&cancelled&&event.status==='PUBLISHED'&&occurrence.startsAt>new Date())
      await announceCancellation(id,{occurrence:{id:occurrence.id,startsAt:occurrence.startsAt},exceptUserId:user.id});
    return Response.json({id:occurrence.id,cancelled:occurrence.cancelled});
  } catch(error) {return apiError(error);}
}
