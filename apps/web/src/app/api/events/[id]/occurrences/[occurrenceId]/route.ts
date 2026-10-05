import {db,lockEvent,queueEventNotice} from '@dance/db';
import {apiError, ApiError, jsonBody} from '../../../../../../lib/api';
import {managedEvent} from '../../../../../../lib/events/access';
import {occurrenceInput} from '../../../../../../lib/events/schema';
import {moveOccurrence} from '../../../../../../lib/events/move';
import {tryEventDelivery} from '../../../../../../lib/events/outbox';
// One date of a series; the other dates are untouched.
//   {cancelled}             cancels or restores the date;
//   {startsLocal,endsLocal} moves it to new wall-clock times in the event's time zone.
export async function PATCH(request:Request,{params}:{params:Promise<{id:string;occurrenceId:string}>}) {
  try {
    const {id,occurrenceId}=await params;
    const {event,user}=await managedEvent(request,id);
    const body=occurrenceInput.parse(await jsonBody(request));
    if ('startsLocal' in body) {
      const {occurrence}=await moveOccurrence(event,occurrenceId,body,new Date(),user.id);
      await tryEventDelivery();
      return Response.json({id:occurrence.id,startsAt:occurrence.startsAt,endsAt:occurrence.endsAt,originalStartsAt:occurrence.originalStartsAt,cancelled:occurrence.cancelled});
    }
    const {cancelled}=body;
    const occurrence=await db.$transaction(async tx=>{
      const current=await lockEvent(tx,id);
      const before=await tx.eventOccurrence.findFirst({where:{id:occurrenceId,eventId:id}});
      if(!before)throw new ApiError('NOT_FOUND',404);
      if(before.cancelled===cancelled)return before;
      const date=await tx.eventOccurrence.update({where:{id:occurrenceId},data:{cancelled}});
      const updated=await tx.event.update({where:{id},data:{version:{increment:1}}});
      if(current.status==='PUBLISHED'&&date.startsAt>new Date())await queueEventNotice(tx,updated,{type:cancelled?'EVENT_CANCELLED':'EVENT_MOVED',key:`event:${id}:${updated.version}:date`,occurrence:date,exceptUserId:user.id});
      return date;
    });
    await tryEventDelivery();
    return Response.json({id:occurrence.id,cancelled:occurrence.cancelled});
  } catch(error) {return apiError(error);}
}
