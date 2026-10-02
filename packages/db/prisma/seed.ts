import {db} from '../src/index';
import {cities} from './data/cities';
import {styleTree} from './data/styles';
// Idempotent: rows are matched by slug and never overwritten, so edits made in the admin panel survive a re-seed.
// The one exception is City.names: localized city names are reference data and are refreshed on every run, no other column is touched.
try {
  for (const city of cities) {
    new Intl.DateTimeFormat('en',{timeZone:city.timezone}).format(new Date());
    await db.city.upsert({where:{slug:city.slug},create:{id:city.slug,...city},update:{names:city.names}});
  }
  // styleTree lists parents before children; the parent is resolved by slug because older rows may have other ids.
  const ids = new Map((await db.danceStyle.findMany({select:{id:true,slug:true}})).map(s => [s.slug,s.id]));
  for (const [slug, name, parent] of styleTree) {
    const style = await db.danceStyle.upsert({where:{slug},update:{},create:{id:slug,slug,name,parentId:parent ? ids.get(parent) : null}});
    ids.set(slug, style.id);
  }
  for (const [id,name] of [
    ['musicality','Musicality'],['improvisation','Improvisation'],['footwork','Footwork'],
    ['connection','Partner connection'],['technique','Technique'],['solo-routines','Solo routines'],
    ['swing-outs','Swing-outs'],['live-music','Live music'],['switch-roles','Switch roles'],
    ['beginner-friendly','Beginner friendly'],['tasters','Taster class']
  ]) await db.tag.upsert({where:{id},create:{id,name},update:{}});
  console.log('Seeded ' + cities.length + ' cities, ' + styleTree.length + ' dance styles and class topic tags.');
} finally { await db.$disconnect(); }
