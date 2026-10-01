import {db} from '@dance/db';
import {ApiError} from './api';
import {eventSchema} from './validation';
import {schedule} from './schedule';
export async function prepareEvent(body:unknown) {
  const input=eventSchema.parse(body);
  const [city,style,tags]=await Promise.all([
    db.city.findUnique({where:{id:input.cityId}}),
    db.danceStyle.findUnique({where:{id:input.styleId}}),
    db.tag.findMany({where:{id:{in:input.tagIds}}})
  ]);
  if(!city||!style||tags.length!==new Set(input.tagIds).size) throw new ApiError('INVALID_INPUT',400);
  const {occurrences,...times}=schedule(input.startsLocal,input.endsLocal,city.timezone,input.recurrenceWeeks);
  const fields={title:input.title,description:input.description,cityId:city.id,timezone:city.timezone,...times,
    status:input.status,kind:input.kind,format:input.format,level:input.level,intensity:input.intensity,
    tempo:input.tempo,prerequisites:input.prerequisites,partnerRequired:input.partnerRequired};
  return {fields,occurrences,styleId:style.id,tagIds:tags.map(t=>t.id)};
}
