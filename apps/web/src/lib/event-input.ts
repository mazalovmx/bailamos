import {db, EventConflict, type Prisma} from '@dance/db';
import {ApiError} from './api';
import {eventInput} from './events/schema';
import {schedule} from './schedule';
import {eventDedupeKey} from './import/dedupe';
import {haversine} from './geo/coarsen';
type Times={startsAt:Date;endsAt:Date|null};
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
  if(input.pin&&haversine(input.pin,city)>150000) throw new ApiError('PIN_TOO_FAR',400);
  const position=input.pin??venue??city;
  let times:ReturnType<typeof schedule>;
  try{
    times=schedule(input.startsLocal,input.endsLocal,city.timezone,
      {count:input.recurrenceCount??input.recurrenceWeeks,interval:input.recurrenceInterval,byDay:input.recurrenceDays,until:input.recurrenceUntil});
  }catch(error){
    if(error instanceof Error&&error.message==='TOO_MANY_DATES') throw new ApiError('TOO_MANY_DATES',400);
    throw error;
  }
  const {occurrences,...when}=times;
  const fields={title:input.title,description:input.description,cityId:city.id,timezone:city.timezone,...when,
    venueId:venue?.id??null,lat:position.lat,lng:position.lng,placeConfirmed:!!venue||!!input.pin,
    priceText:input.priceText,address:input.address,mapImageKey:input.mapImageKey,mapNote:input.mapNote,attendeeVisibility:input.attendeeVisibility,
    status:input.status,kind:input.kind,format:input.format,level:input.level,intensity:input.intensity,
    tempo:input.tempo,prerequisites:input.prerequisites,partnerRequired:input.partnerRequired,
    // The same key the importer computes, so an imported copy of this event is recognised as a duplicate.
    dedupeKey:eventDedupeKey({title:input.title,startsAt:when.startsAt,timezone:city.timezone,cityId:city.id,lat:position.lat,lng:position.lng,precise:!!venue||!!input.pin})};
  // Whether the organizer gave an exact place: a venue of the directory or a marker on the map.
  return {fields,occurrences:occurrences.map(row=>({...row,slotStartsAt:row.startsAt})),styleId:style.id,tagIds:tags.map(t=>t.id),schoolProfileId:input.schoolProfileId,exactPlace:!!venue||!!input.pin};
}
// Keep matching slots first, then pair unmatched future slots in order. Never delete a date or its answers.
// Individual moves and cancellations are exceptions: they survive a whole-series edit. Past dates are immutable.
export async function syncOccurrences(tx:Prisma.TransactionClient,eventId:string,occurrences:Times[],now=new Date(),shiftSeries=false) {
  const existing=await tx.eventOccurrence.findMany({where:{eventId},orderBy:{slotStartsAt:'asc'}});
  const slot=(row:typeof existing[number])=>(row.slotStartsAt??row.originalStartsAt??row.startsAt).getTime();
  const remaining=new Map(occurrences.map(row=>[row.startsAt.getTime(),row]));
  const assignments=new Map<string,Times>();
  for(const [index,row] of existing.entries()){
    const match=shiftSeries?occurrences[index]:remaining.get(slot(row));
    if(match){assignments.set(row.id,match);remaining.delete(match.startsAt.getTime());}
  }
  const unmatched=existing.filter(row=>!assignments.has(row.id)&&row.startsAt>now).sort((a,b)=>slot(a)-slot(b));
  for(const next of [...remaining.values()].filter(row=>row.startsAt>now).sort((a,b)=>a.startsAt.getTime()-b.startsAt.getTime())){
    const row=unmatched.shift();if(!row)break;assignments.set(row.id,next);remaining.delete(next.startsAt.getTime());
  }
  const occupied=new Set<number>();
  for(const row of existing){const next=assignments.get(row.id);const start=row.startsAt<=now||row.originalStartsAt||!next?row.startsAt:next.startsAt;
    if(occupied.has(start.getTime()))throw new EventConflict('DATE_TAKEN');occupied.add(start.getTime());}
  for(const row of existing){
    if(row.startsAt<=now)continue;
    const next=assignments.get(row.id);
    if(!next){await tx.eventOccurrence.update({where:{id:row.id},data:{cancelled:true}});continue;}
    if(row.originalStartsAt){await tx.eventOccurrence.update({where:{id:row.id},data:{slotStartsAt:next.startsAt}});continue;}
    const moved=row.startsAt.getTime()!==next.startsAt.getTime();
    await tx.eventOccurrence.update({where:{id:row.id},data:{...next,slotStartsAt:next.startsAt,
      ...(moved?{previousStarts:{push:row.startsAt.toISOString()},reminderSentAt:null}:{})}});
  }
  const added=[...remaining.values()].filter(row=>row.startsAt>now&&!occupied.has(row.startsAt.getTime()));
  if(added.length)await tx.eventOccurrence.createMany({data:added.map(row=>({...row,eventId,slotStartsAt:row.startsAt}))});
}
