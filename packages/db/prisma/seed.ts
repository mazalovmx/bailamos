import {db} from '../src/index';
import {additionalCities,additionalStyles} from './catalogue-additions';
const styles = [
  ['salsa', 'Salsa', null], ['bachata', 'Bachata', null], ['tango', 'Tango', null],
  ['kizomba', 'Kizomba', null], ['swing', 'Swing', null],
  ['lindy-hop', 'Lindy Hop', 'swing'],
  ['solo-jazz', 'Solo Jazz', 'swing'],
  ['balboa', 'Balboa', 'swing'],
  ['collegiate-shag', 'Collegiate Shag', 'swing'],
  ['st-louis-shag', 'St. Louis Shag', 'swing'],
  ['charleston', 'Charleston', 'swing'],
  ['solo-charleston', 'Solo Charleston', 'charleston'],
  ['partner-charleston', 'Partnered Charleston', 'charleston'],
  ['boogie-woogie', 'Boogie Woogie', 'swing'],
  ['bachata-sensual', 'Bachata sensual', 'bachata'],
  ['bachata-dominican', 'Dominican bachata', 'bachata']
] as const;
try {
  const cities = [
    {id:'mexico-city',slug:'mexico-city',name:'Ciudad de México',countryCode:'MX',timezone:'America/Mexico_City',lat:19.4326,lng:-99.1332},
    {id:'madrid',slug:'madrid',name:'Madrid',countryCode:'ES',timezone:'Europe/Madrid',lat:40.4168,lng:-3.7038},
    {id:'moscow',slug:'moscow',name:'Москва',countryCode:'RU',timezone:'Europe/Moscow',lat:55.7558,lng:37.6173}
  ];
  for (const city of cities) await db.city.upsert({where:{id:city.id},create:city,update:{}});
  for (const city of additionalCities) {
    new Intl.DateTimeFormat('en',{timeZone:city.timezone}).format(new Date());
    await db.city.upsert({where:{id:city.id},create:{...city,slug:city.id},update:{}});
  }
  for (const [id, name, parentId] of styles) {
    await db.danceStyle.upsert({where: {id}, update: {}, create: {id, slug: id, name, parentId}});
  }
  for(const [id,name,parentId] of additionalStyles) await db.danceStyle.upsert({where:{id},create:{id,slug:id,name,parentId},update:{}});
  for (const [id,name] of [
    ['musicality','Musicality'],['improvisation','Improvisation'],['footwork','Footwork'],
    ['connection','Partner connection'],['technique','Technique'],['solo-routines','Solo routines'],
    ['swing-outs','Swing-outs'],['live-music','Live music'],['switch-roles','Switch roles'],
    ['beginner-friendly','Beginner friendly'],['tasters','Taster class']
  ]) await db.tag.upsert({where:{id},create:{id,name},update:{}});
  console.log('Seeded swing styles, cities and class topic tags.');
} finally { await db.$disconnect(); }
