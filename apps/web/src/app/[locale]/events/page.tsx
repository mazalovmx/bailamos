import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import Link from 'next/link';
import {catalogue} from '../../../lib/catalogue';
import {EventCard} from '../../../components/event-card';
import {EventFilters} from '../../../components/event-filters';
import {eventSearchAll} from '../../../lib/event-search';
import {first,queryParams} from '../../../lib/search-query';
export async function generateMetadata(){const t=await getTranslations('App');return {title:t('events'),description:t('intro')};}
export default async function Events({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {locale}=await params,rawQuery=await searchParams,t=await getTranslations('App');
  const query=rawQuery;
  const rawPage=Number(first(query.page)),page=Number.isSafeInteger(rawPage)&&rawPage>0?Math.min(rawPage,10000):1;
  const where={cancelled:false,startsAt:{gte:new Date()},event:await eventSearchAll(query)};
  const [{cities,styles,tags},sessions,total]=await Promise.all([catalogue(),db.eventOccurrence.findMany({where,orderBy:[{startsAt:'asc'},{id:'asc'}],skip:(page-1)*12,take:12,include:{event:{include:{city:true,styles:{include:{style:true}}}}}}),db.eventOccurrence.count({where})]);
  const pageUrl=(n:number)=>'?'+queryParams({...query,page:String(n)});
  return <main><section className="app-hero"><p className="eyebrow">Lindy Hop · Solo Jazz · Swing</p><h1>{t('headline')}</h1><p className="intro">{t('intro')}</p><Link className="button" href={'/'+locale+'/events/new'}>{t('newEvent')} <span aria-hidden="true">↗</span></Link></section>
    <section className="event-section"><h2>{t('upcoming')}</h2>
    <EventFilters locale={locale} query={query} cities={cities} styles={styles} tags={tags}/>
    {sessions.length?<div className="event-grid">{sessions.map(session=><EventCard key={session.id} event={session.event} displayDate={session.startsAt} locale={locale}/>)}</div>:
      <div className="empty"><span aria-hidden="true">✳</span><div><h3>{t('empty')}</h3><p>{t('emptyText')}</p><Link href={'/'+locale+'/events/new'}>{t('newEvent')}</Link></div></div>}
    <nav className="pagination" aria-label={t('events')}>{page>1&&<Link href={pageUrl(page-1)}>{t('previous')}</Link>}{page*12<total&&<Link href={pageUrl(page+1)}>{t('next')}</Link>}</nav></section>
  </main>;
}
