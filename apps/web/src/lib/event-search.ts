import type {Prisma} from '@dance/db';
import {eventKinds,danceFormats,classLevels,intensities,tempos,styleFamily} from './swing';
import {type SearchQuery,values,first} from './search-query';
// styleIds: the selected styles already expanded to their sub-styles (see eventSearchAll); without it the static swing families are used.
export function eventSearch(query:SearchQuery,styleIds?:string[]):Prisma.EventWhereInput {
  const kind=eventKinds.filter(v=>values(query.kind).includes(v)),format=danceFormats.filter(v=>values(query.format).includes(v)),
    level=classLevels.filter(v=>values(query.level).includes(v)),intensity=intensities.filter(v=>values(query.intensity).includes(v)),
    tempo=tempos.filter(v=>values(query.tempo).includes(v));
  return {status:'PUBLISHED',hiddenAt:null,
    ...(values(query.city).filter(c=>c!=='all').length?{cityId:{in:values(query.city).filter(c=>c!=='all')}}:{}),
    ...(values(query.style).length?{styles:{some:{styleId:{in:styleIds??[...new Set(values(query.style).flatMap(styleFamily))]}}}}:{}),
    ...(first(query.q)?{title:{contains:first(query.q).slice(0,100),mode:'insensitive' as const}}:{}),
    ...(kind.length?{kind:{in:kind}}:{}),...(format.length?{format:{in:format}}:{}),...(level.length?{level:{in:level}}:{}),...(intensity.length?{intensity:{in:intensity}}:{}),...(tempo.length?{tempo:{in:tempo}}:{}),
    ...(values(query.tag).length?{tags:{some:{tagId:{in:values(query.tag)}}}}:{}),
    ...(values(query.noPartner).includes('1')?{partnerRequired:false}:{}),
    ...(values(query.recurring).includes('1')?{rrule:{not:null}}:{})
  };
}
// The filter used by pages: every selected style also finds events of all its descendants in the DanceStyle tree.
export async function eventSearchAll(query:SearchQuery):Promise<Prisma.EventWhereInput> {
  const selected=values(query.style);
  if(!selected.length) return eventSearch(query);
  const {styleDescendantIds}=await import('./catalogue/data');
  const expanded=await Promise.all(selected.map(id=>styleDescendantIds(id)));
  return eventSearch(query,[...new Set([...selected,...selected.flatMap(styleFamily),...expanded.flat()])]);
}
