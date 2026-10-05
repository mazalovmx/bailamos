import {DateTime} from 'luxon';
import {first,values,type SearchQuery} from './search-query';
export function discoveryDates(query:SearchQuery,zone='UTC',now=new Date()){
  const day=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?DateTime.fromISO(value,{zone}):null;
  const from=day(first(query.from)),to=day(first(query.to));
  const lower=from?.isValid?from.startOf('day').toJSDate():now;
  const upper=to?.isValid?to.plus({days:1}).startOf('day').toJSDate():undefined;
  return {gte:lower,...(upper?{lt:upper}:{})};
}
export async function discoveryQuery(raw:SearchQuery){
  const [{currentCitySlug},{allCities,allStyles}]=await Promise.all([import('./catalogue/current-city'),import('./catalogue/data')]);
  const [cookie,cities,styles]=await Promise.all([currentCitySlug(),allCities(),allStyles()]);
  const city=raw.city===undefined?(cookie?[cookie]:[]):values(raw.city);
  const ids=city.filter(c=>c!=='all').map(c=>cities.find(item=>item.id===c||item.slug===c)?.id||c);
  const query:SearchQuery={...raw,city:ids.length?ids:['all'],style:values(raw.style).map(s=>styles.find(item=>item.id===s||item.slug===s)?.id||s)};
  const zone=ids.length===1?cities.find(c=>c.id===ids[0])?.timezone||'UTC':'UTC';
  return {query,zone};
}
