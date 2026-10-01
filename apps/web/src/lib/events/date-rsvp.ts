import {db} from '@dance/db';
import {ApiError} from '../api';
import {dateAnswers,effectiveAnswer,setOccurrenceRsvp,type Answer} from './attendees';
type ProfileRef={id:string;handle:string;name:string};
// The checks of PUT/DELETE /api/events/[id]/occurrences/[occurrenceId]/rsvp and the answer itself.
// Only an upcoming, not cancelled date of a published series can be answered; an override can always be removed.
export async function answerDate(eventId:string,occurrenceId:string,profile:ProfileRef,status:Answer|null,now=new Date()) {
  const event=await db.event.findUnique({where:{id:eventId},select:{id:true,slug:true,title:true,status:true,hiddenAt:true,
    occurrences:{select:{id:true,startsAt:true,cancelled:true}}}});
  const occurrence=event?.occurrences.find(o=>o.id===occurrenceId);
  if(!event||!occurrence||event.status==='DRAFT'||event.hiddenAt) throw new ApiError('NOT_FOUND',404);
  if(status){
    if(event.occurrences.length<2) throw new ApiError('NOT_A_SERIES',400);
    if(event.status!=='PUBLISHED'||occurrence.cancelled||occurrence.startsAt<now) throw new ApiError('EVENT_UNAVAILABLE',400);
  }
  await setOccurrenceRsvp(event,occurrenceId,profile,status);
  const {series,effective}=await dateAnswers(eventId,occurrenceId),rows=[...effective.values()];
  const seriesOwn=series.get(profile.id)?.status??null;
  return {status,series:seriesOwn,effective:effectiveAnswer(seriesOwn,status),
    going:rows.filter(row=>row.status==='GOING').length,interested:rows.filter(row=>row.status==='INTERESTED').length};
}
