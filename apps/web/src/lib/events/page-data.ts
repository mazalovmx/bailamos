import {cache} from 'react';
import {db} from '@dance/db';
import {routing} from '../../i18n/routing';
import {siteUrl} from '../mail';
// One query for the event page, its metadata and its preview image.
export const loadEvent=cache((slug:string)=>db.event.findUnique({where:{slug},include:{
  city:true,venue:true,styles:{include:{style:true}},tags:{include:{tag:true}},occurrences:{orderBy:{startsAt:'asc'}},
  members:{include:{profile:{select:{id:true,handle:true,name:true,type:true,userId:true,hiddenAt:true}}}}}}));
export type LoadedEvent=NonNullable<Awaited<ReturnType<typeof loadEvent>>>;
// The date a visitor is looking at: the one named in ?date=, else the next upcoming one, else the last one.
// A link made before a date was moved names its original start and still finds it.
export function pickOccurrence(event:Pick<LoadedEvent,'occurrences'>,requested?:string,now=new Date()) {
  return event.occurrences.find(o=>o.startsAt.toISOString()===requested)
    ||event.occurrences.find(o=>!!requested&&o.originalStartsAt?.toISOString()===requested)
    ||event.occurrences.find(o=>!!requested&&o.previousStarts?.includes(requested))
    ||event.occurrences.find(o=>!o.cancelled&&o.startsAt>=now)||event.occurrences.at(-1)||null;
}
export function eventLinks(slug:string,locale:string,shortCode?:string|null) {
  const origin=siteUrl(),path=(code:string)=>origin+'/'+code+'/events/'+slug;
  return {origin,canonical:path(locale),short:shortCode?origin+'/e/'+shortCode:path(locale),
    languages:{...Object.fromEntries(routing.locales.map(code=>[code,path(code)])),'x-default':path(routing.defaultLocale)}};
}
