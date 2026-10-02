import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {EventCard} from '../../../components/event-card';
import '../../styles/events.css';
export async function generateMetadata(){const t=await getTranslations('App');return {title:t('myEvents'),robots:{index:false,follow:false}};}
export default async function MyEvents({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser();
  if(!user) redirect('/'+locale+'/login');
  const t=await getTranslations('App'),x=await getTranslations('EventsX');
  const include={city:true,styles:{include:{style:true}}} as const,now=new Date();
  const [events,attending,invites]=await Promise.all([
    user.profile?db.event.findMany({where:{members:{some:{profileId:user.profile.id,role:{in:['OWNER','CO_ORGANIZER']}}}},orderBy:{createdAt:'desc'},take:100,include}):[],
    // What I answered "going" or "interested" to — the whole event or a single date still ahead — and what is still ahead.
    user.profile?db.event.findMany({where:{status:{in:['PUBLISHED','CANCELLED']},hiddenAt:null,occurrences:{some:{startsAt:{gte:now}}},
      OR:[{rsvps:{some:{profileId:user.profile.id,status:{in:['GOING','INTERESTED']}}}},
        {occurrences:{some:{startsAt:{gte:now},rsvps:{some:{profileId:user.profile.id,status:{in:['GOING','INTERESTED']}}}}}}]},orderBy:{startsAt:'asc'},take:50,include}):[],
    // Invitations addressed to my profile or to my verified email.
    db.eventInvite.findMany({where:{acceptedAt:null,expiresAt:{gt:now},OR:[...(user.profile?[{profileId:user.profile.id}]:[]),...(user.emailVerified?[{email:user.email.toLowerCase()}]:[])]},
      orderBy:{createdAt:'desc'},take:20,select:{token:true,event:{select:{title:true}}}})
  ]);
  return <main className="detail-page"><h1>{t('myEventsTitle')}</h1><p className="intro">{t('myEventsText')}</p><Link className="button" href={'/'+locale+'/events/new'}>{t('newEvent')}</Link>
    {invites.length>0&&<section aria-labelledby="my-invites"><h2 id="my-invites">{x('myInvites')}</h2>
      <ul className="people-list">{invites.map(i=><li key={i.token}><Link href={'/'+locale+'/invites/'+i.token}>{x('inviteFor',{title:i.event.title})}</Link></li>)}</ul></section>}
    <section aria-labelledby="my-organized"><h2 id="my-organized">{x('myOrganized')}</h2>
    {events.length?<div className="event-grid">{events.map(event=><EventCard key={event.id} event={event} locale={locale}/>)}</div>:<div className="empty"><p>{t('noOwned')}</p></div>}</section>
    {attending.length>0&&<section aria-labelledby="my-attending"><h2 id="my-attending">{x('myAttending')}</h2>
      <div className="event-grid">{attending.map(event=><EventCard key={event.id} event={event} locale={locale}/>)}</div></section>}
  </main>;
}
