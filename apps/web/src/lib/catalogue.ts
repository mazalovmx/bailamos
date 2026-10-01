import {db} from '@dance/db';
import {swingStyles} from './swing';
export async function catalogue() {
  const [cities,styles]=await Promise.all([db.city.findMany({orderBy:{name:'asc'},select:{id:true,name:true,timezone:true}}),db.danceStyle.findMany({orderBy:{name:'asc'},select:{id:true,name:true}})]);
  styles.sort((a,b) => {
    const ai=swingStyles.indexOf(a.id),bi=swingStyles.indexOf(b.id);
    return (ai<0?100:ai)-(bi<0?100:bi)||a.name.localeCompare(b.name);
  });
  const tags=await db.tag.findMany({orderBy:{name:'asc'}});
  return {cities,styles,tags};
}
