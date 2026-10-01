import {db, type Prisma} from '@dance/db';
import {ApiError} from './api';
import {eventInput} from './events/schema';
import {schedule} from './schedule';
import {eventDedupeKey} from './import/dedupe';
type Times={startsAt:Date;endsAt:Date};
export async function prepareEvent(body:unknown) {
  const input=eventInput.parse(body);
  const [city,style,tags,venue]=await Promise.all([
    db.city.findUnique({where:{id:input.cityId}}),
    db.danceStyle.findUnique({where:{id:input.styleId}}),
    db.tag.findMany({where:{id:{in:input.tagIds}}}),
    input.venueId?db.venue.findUnique({where:{id:input.venueId}}):null
  ]);
  if(!city||!style||tags.length!==new Set(input.tagIds).size) throw new ApiError('INVALID_INPUT',400);
  // A venue must belong to the chosen city: the event's timezone and its place on the map come from there.
  if(input.venueId&&(!venue||venue.hiddenAt||venue.cityId!==city.id)) throw new ApiError('INVALID_VENUE',400);
  let times:ReturnType<typeof schedule>;
  try{
    times=schedule(input.startsLocal,input.endsLocal,city.timezone,
      {count:input.recurrenceWeeks,interval:input.recurrenceInterval,byDay:input.recurrenceDays,until:input.recurrenceUntil});
  }catch(error){
    if(error instanceof Error&&error.message==='TOO_MANY_DATES') throw new ApiError('TOO_MANY_DATES',400);
    throw error;
  }
  const {occurrences,...when}=times;
  const fields={title:input.title,description:input.description,cityId:city.id,timezone:city.timezone,...when,
    venueId:venue?.id??null,lat:venue?.lat??city.lat,lng:venue?.lng??city.lng,
    priceText:input.priceText,attendeeVisibility:input.attendeeVisibility,
    status:input.status,kind:input.kind,format:input.format,level:input.level,intensity:input.intensity,
    tempo:input.tempo,prerequisites:input.prerequisites,partnerRequired:input.partnerRequired,
    // The same key the importer computes, so an imported copy of this event is recognised as a duplicate.
    dedupeKey:eventDedupeKey({title:input.title,startsAt:when.startsAt,timezone:city.timezone,cityId:city.id,lat:venue?.lat??city.lat,lng:venue?.lng??city.lng,precise:!!venue})};
  return {fields,occurrences,styleId:style.id,tagIds:tags.map(t=>t.id),schoolProfileId:input.schoolProfileId};
}
// Replaces the dates of a series while keeping rows whose start did not move: a cancelled date stays cancelled
// and a reminder that was already sent is not sent again.
export async function syncOccurrences(tx:Prisma.TransactionClient,eventId:string,occurrences:Times[]) {
  const existing=await tx.eventOccurrence.findMany({where:{eventId},select:{id:true,startsAt:true,endsAt:true}});
  const wanted=new Map(occurrences.map(o=>[o.startsAt.getTime(),o]));
  const kept=new Set<number>();
  for(const row of existing){
    const match=wanted.get(row.startsAt.getTime());
    if(!match) continue;
    kept.add(row.startsAt.getTime());
    if(row.endsAt?.getTime()!==match.endsAt.getTime()) await tx.eventOccurrence.update({where:{id:row.id},data:{endsAt:match.endsAt}});
  }
  await tx.eventOccurrence.deleteMany({where:{eventId,id:{in:existing.filter(row=>!kept.has(row.startsAt.getTime())).map(row=>row.id)}}});
  const added=occurrences.filter(o=>!kept.has(o.startsAt.getTime()));
  if(added.length) await tx.eventOccurrence.createMany({data:added.map(o=>({eventId,...o}))});
}
