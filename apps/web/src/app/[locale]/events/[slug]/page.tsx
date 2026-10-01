import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {eventAbility} from '../../../../lib/permissions';
import {RsvpButtons} from '../../../../components/forms';
import {AnnouncementStudio} from '../../../../components/announcement-studio';
export default async function EventPage({params,searchParams}:{params:Promise<{locale:string;slug:string}>;searchParams:Promise<{date?:string}>}) {
  const {locale,slug}=await params;
  const event=await db.event.findUnique({where:{slug},include:{city:true,styles:{include:{style:true}},tags:{include:{tag:true}},occurrences:{orderBy:{startsAt:'asc'}},members:{include:{profile:{select:{id:true,handle:true,name:true}}}}}});
  if(!event) notFound();
  const user=await currentUser(),canManage=eventAbility(user?.profile?.id,event.members).can('manage','Event');
  if(event.status==='DRAFT'&&!canManage) notFound();
  const t=await getTranslations('App');
  const [going,interested,rsvp]=await Promise.all([db.rsvp.count({where:{eventId:event.id,status:'GOING'}}),db.rsvp.count({where:{eventId:event.id,status:'INTERESTED'}}),user?.profile?db.rsvp.findUnique({where:{eventId_profileId:{eventId:event.id,profileId:user.profile.id}}}):null]);
  const date=(value:Date)=>new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:event.timezone}).format(value);
  const now=new Date(),nextDates=event.occurrences.filter(o=>!o.cancelled&&o.startsAt>=now);
  const requestedDate=(await searchParams).date;
  const selected=event.occurrences.find(o=>o.startsAt.toISOString()===requestedDate)||nextDates[0]||event.occurrences.at(-1);
  const startsAt=selected?.startsAt||event.startsAt,endsAt=selected?.endsAt||event.endsAt;
  const isPast=(endsAt||startsAt)<now;
  return <main className="detail-page"><Link href={'/'+locale+'/events'}>← {t('back')}</Link>
    <div className="tags">{event.styles.map(({style})=><span key={style.id}>{style.name}</span>)}<span>{t(event.status)}</span></div>
    <h1>{event.title}</h1><div className="event-facts"><div><h2>{t('time')}</h2><p><time dateTime={startsAt.toISOString()}>{date(startsAt)}</time></p>{endsAt&&<p>— {date(endsAt)}</p>}<small>{event.timezone}</small></div>
    <div><h2>{t('location')}</h2><p>{event.city.name}</p></div></div>
    {event.status==='CANCELLED'&&<p className="notice">{t('cancelledText')}</p>}{isPast&&<p className="notice">{t('pastText')}</p>}
    <h2>{t('classification')}</h2><dl className="class-facts">
      <div><dt>{t('kind')}</dt><dd>{t('kind_'+event.kind)}</dd></div>
      <div><dt>{t('format')}</dt><dd>{t('format_'+event.format)}</dd></div>
      <div><dt>{t('classLevel')}</dt><dd>{t('level_'+event.level)}</dd></div>
      <div><dt>{t('intensity')}</dt><dd>{t('intensity_'+event.intensity)}</dd></div>
      <div><dt>{t('tempo')}</dt><dd>{t('tempo_'+event.tempo)}</dd></div>
    </dl>
    {event.format!=='SOLO'&&event.partnerRequired!==null&&<p className="notice">{t(event.partnerRequired?'partnerRequired':'noPartnerNeeded')}</p>}
    <div className="tags">{event.tags.map(({tag})=><Link key={tag.id} href={'/'+locale+'/events?tag='+encodeURIComponent(tag.id)}>{t.has('tag_'+tag.id)?t('tag_'+tag.id):tag.name}</Link>)}</div>
    <p className="prose">{event.description}</p>
    {event.prerequisites&&<><h2>{t('prerequisites')}</h2><p className="prose">{event.prerequisites}</p></>}
    {event.rrule&&<details className="session-list" open><summary>{t('nextSessions')} · {t('sessionCount',{count:event.occurrences.length})}</summary><ol>{event.occurrences.map(o=><li key={o.id}><Link aria-current={o.id===selected?.id?'date':undefined} href={'?date='+encodeURIComponent(o.startsAt.toISOString())}>{date(o.startsAt)}</Link></li>)}</ol></details>}
    {event.status==='PUBLISHED'&&<details className="event-share"><summary>{t('shareEvent')} ↗</summary><p>{t('selectedDate')}</p><AnnouncementStudio key={startsAt.toISOString()} initial={{title:event.title,date:date(startsAt)+' · '+event.timezone,place:event.city.name,text:event.styles.map(s=>s.style.name).join(' · ')+' · '+t('kind_'+event.kind)}} urlPath={'/'+locale+'/events/'+slug+'?date='+encodeURIComponent(startsAt.toISOString())}/></details>}
    <h2>{t('organizer')}</h2>
    <div className="organizers">{event.members.filter(m=>m.role==='OWNER'||m.role==='CO_ORGANIZER').map(m=><Link key={m.profileId+m.role} href={'/'+locale+'/people/'+m.profile.handle}>{m.profile.name}</Link>)}</div>
    {canManage&&<Link className="button secondary" href={'/'+locale+'/events/'+slug+'/edit'}>{t('editEvent')}</Link>}
    <section className="rsvp-panel"><h2>{t('rsvpTitle')}</h2><p>{t('goingCount',{count:going})} · {t('interestedCount',{count:interested})}</p>
    {event.rrule&&<p>{t('seriesRsvp')}</p>}
    {event.status==='PUBLISHED'&&nextDates.length>0&&(user?.profile?<RsvpButtons eventId={event.id} initial={rsvp?.status||''}/>:<Link className="button" href={'/'+locale+(user?'/profile':'/login')}>{t(user?'profileRequired':'signInRsvp')}</Link>)}</section>
  </main>;
}
