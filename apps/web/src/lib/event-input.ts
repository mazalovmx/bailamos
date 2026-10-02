import {db, type Prisma} from '@dance/db';
import {ApiError} from './api';
import {eventInput} from './events/schema';
import {schedule} from './schedule';
import {eventDedupeKey} from './import/dedupe';
import {haversine} from './geo/coarsen';
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
  if(input.pin&&haversine(input.pin,city)>150000) throw new ApiError('PIN_TOO_FAR',400);
  const position=input.pin??venue??city;
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
    venueId:venue?.id??null,lat:position.lat,lng:position.lng,
    priceText:input.priceText,address:input.address,mapImageKey:input.mapImageKey,mapNote:input.mapNote,attendeeVisibility:input.attendeeVisibility,
    status:input.status,kind:input.kind,format:input.format,level:input.level,intensity:input.intensity,
    tempo:input.tempo,prerequisites:input.prerequisites,partnerRequired:input.partnerRequired,
    // The same key the importer computes, so an imported copy of this event is recognised as a duplicate.
    dedupeKey:eventDedupeKey({title:input.title,startsAt:when.startsAt,timezone:city.timezone,cityId:city.id,lat:position.lat,lng:position.lng,precise:!!venue||!!input.pin})};
  // Whether the organizer gave an exact place: a venue of the directory or a marker on the map.
  return {fields,occurrences,styleId:style.id,tagIds:tags.map(t=>t.id),schoolProfileId:input.schoolProfileId,exactPlace:!!venue||!!input.pin};
}
// Replaces the dates of a series while keeping rows whose start did not move: a cancelled date stays cancelled
// and a reminder that was already sent is not sent again.
// A date that was moved on its own (originalStartsAt) stands for the slot the series had scheduled for it: while the
// series still contains that slot the row stays exactly as the organizer left it and no second row is created for
// the slot; when the series no longer contains the slot, the moved date goes with it.
export async function syncOccurrences(tx:Prisma.TransactionClient,eventId:string,occurrences:Times[]) {
  const existing=await tx.eventOccurrence.findMany({where:{eventId},select:{id:true,startsAt:true,endsAt:true,originalStartsAt:true}});
  const wanted=new Map(occurrences.map(o=>[o.startsAt.getTime(),o]));
  // `kept` holds the series slots that already have a row; `taken` the starts that rows occupy after the save.
  const kept=new Set<number>(),taken=new Set<number>(),stay=new Set<string>();
  for(const row of existing.filter(row=>row.originalStartsAt)){
    const slot=row.originalStartsAt!.getTime();
    if(!wanted.has(slot)||kept.has(slot)) continue;
    kept.add(slot);taken.add(row.startsAt.getTime());stay.add(row.id);
  }
  for(const row of existing.filter(row=>!row.originalStartsAt)){
    const start=row.startsAt.getTime(),match=wanted.get(start);
    if(!match||kept.has(start)) continue;
    kept.add(start);taken.add(start);stay.add(row.id);
    if(row.endsAt?.getTime()!==match.endsAt.getTime()) await tx.eventOccurrence.update({where:{id:row.id},data:{endsAt:match.endsAt}});
  }
  await tx.eventOccurrence.deleteMany({where:{eventId,id:{in:existing.filter(row=>!stay.has(row.id)).map(row=>row.id)}}});
  // A new slot is not materialized on top of a moved date that already occupies that very time.
  const added=occurrences.filter(o=>!kept.has(o.startsAt.getTime())&&!taken.has(o.startsAt.getTime()));
  if(added.length) await tx.eventOccurrence.createMany({data:added.map(o=>({eventId,...o}))});
}
