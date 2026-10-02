import {db} from '@dance/db';
import {swingStyles} from './swing';
import {cityName} from './catalogue/city-name';
// With a locale, city names come back in that language (and sorted for it); without one, in local spelling as before.
export async function catalogue(locale?: string) {
  const [rows,styles]=await Promise.all([db.city.findMany({orderBy:{name:'asc'},select:{id:true,name:true,names:true,timezone:true,lat:true,lng:true}}),db.danceStyle.findMany({orderBy:{name:'asc'},select:{id:true,name:true}})]);
  styles.sort((a,b) => {
    const ai=swingStyles.indexOf(a.id),bi=swingStyles.indexOf(b.id);
    return (ai<0?100:ai)-(bi<0?100:bi)||a.name.localeCompare(b.name);
  });
  const cities=rows.map(({names,...city})=>({...city,name:locale?cityName({name:city.name,names},locale):city.name}));
  if(locale) cities.sort((a,b)=>a.name.localeCompare(b.name,locale));
  const tags=await db.tag.findMany({orderBy:{name:'asc'}});
  return {cities,styles,tags};
}
