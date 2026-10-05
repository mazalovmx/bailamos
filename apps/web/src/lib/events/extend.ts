import {db,lockEvent} from '@dance/db';
import {ApiError} from '../api';
import {localStamp,parseRecurrence,schedule,MAX_DATES} from '../schedule';

export async function extendSeries(eventId:string,count:number,version:number,now=new Date()){
  if(!Number.isInteger(count)||count<1||count>52)throw new ApiError('INVALID_INPUT',400);
  return db.$transaction(async tx=>{
    const event=await lockEvent(tx,eventId,version);
    if(!event.rrule||!event.endsAt)throw new ApiError('NOT_A_SERIES',400);
    const dates=await tx.eventOccurrence.findMany({where:{eventId},select:{slotStartsAt:true,startsAt:true,originalStartsAt:true}});
    const latest=Math.max(...dates.map(d=>(d.slotStartsAt??d.originalStartsAt??d.startsAt).getTime()),now.getTime());
    const recurrence=parseRecurrence(event.rrule,event.timezone);
    const expanded=schedule(localStamp(event.startsAt,event.timezone),localStamp(event.endsAt,event.timezone),event.timezone,{...recurrence,until:null,count:MAX_DATES});
    const next=expanded.occurrences.filter(d=>d.startsAt.getTime()>latest).slice(0,count);
    if(next.length<count)throw new ApiError('TOO_MANY_DATES',400);
    const total=expanded.occurrences.findIndex(d=>d.startsAt.getTime()===next.at(-1)!.startsAt.getTime())+1;
    await tx.eventOccurrence.createMany({data:next.map(d=>({...d,eventId,slotStartsAt:d.startsAt}))});
    const updated=await tx.event.update({where:{id:eventId},data:{version:{increment:1},rrule:expanded.rrule!.replace(/COUNT=\d+/,`COUNT=${total}`)}});
    return {added:next.length,version:updated.version};
  });
}
