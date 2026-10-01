import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {EventCard} from '../../../components/event-card';
export default async function MyEvents({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser();
  if(!user) redirect('/'+locale+'/login');
  const t=await getTranslations('App');
  const events=user.profile?await db.event.findMany({where:{members:{some:{profileId:user.profile.id,role:{in:['OWNER','CO_ORGANIZER']}}}},orderBy:{createdAt:'desc'},take:100,include:{city:true,styles:{include:{style:true}}}}):[];
  return <main className="detail-page"><h1>{t('myEventsTitle')}</h1><p className="intro">{t('myEventsText')}</p><Link className="button" href={'/'+locale+'/events/new'}>{t('newEvent')}</Link>
    {events.length?<div className="event-grid">{events.map(event=><EventCard key={event.id} event={event} locale={locale}/>)}</div>:<div className="empty"><p>{t('noOwned')}</p></div>}</main>;
}
