import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {eventAbility} from '../../../../lib/permissions';
import {managesSchool} from '../../../../lib/schools/access';
import {isPublic} from '../../../../lib/events/access';
import {loadEvent,pickOccurrence,eventLinks} from '../../../../lib/events/page-data';
import {listAttendees} from '../../../../lib/events/attendees';
import {eventJsonLd,safeJson} from '../../../../lib/events/jsonld';
import {zoneName} from '../../../../lib/events/time';
import {RsvpButtons} from '../../../../components/forms';
import {AnnouncementStudio} from '../../../../components/announcement-studio';
import {ViewerTime} from '../../../../components/events/viewer-time';
import {ShareButtons} from '../../../../components/events/share-buttons';
import {LocationMap} from '../../../../components/geo/location-map';
import {AddToCalendar} from '../../../../components/calendar/add-to-calendar';
import {EventMedia} from '../../../../components/media/event-media';
import {EventPosts} from '../../../../components/blog/event-posts';
import {RoomLink} from '../../../../components/chat/room-link';
import {ReportButton} from '../../../../components/moderation/report-button';
import '../../../styles/events.css';
type Props={params:Promise<{locale:string;slug:string}>;searchParams:Promise<{date?:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {locale,slug}=await params,event=await loadEvent(slug);
  // Drafts and hidden events give nothing away, not even a title, and are never indexed.
  if(!event||!isPublic(event)) return {robots:{index:false,follow:false}};
  const x=await getTranslations({locale,namespace:'EventsX'}),links=eventLinks(slug,locale,event.shortCode);
  const when=pickOccurrence(event),startsAt=when?.startsAt||event.startsAt;
  const date=new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:event.timezone}).format(startsAt);
  const place=[event.venue&&!event.venue.hiddenAt?event.venue.name:'',event.city.name].filter(Boolean).join(', ');
  const title=event.status==='CANCELLED'?x('metaCancelled',{title:event.title}):event.title;
  const description=[date+' ('+event.timezone+')',place,(event.description||'').replace(/\s+/g,' ').slice(0,160)].filter(Boolean).join(' · ');
  return {title,description,metadataBase:new URL(links.origin),
    alternates:{canonical:links.canonical,languages:links.languages},
    openGraph:{type:'website',title,description,url:links.canonical,siteName:'Dance Community',locale,alternateLocale:Object.keys(links.languages).filter(code=>code!==locale&&code!=='x-default')},
    twitter:{card:'summary_large_image',title,description}};
}
export default async function EventPage({params,searchParams}:Props) {
  const {locale,slug}=await params;
  const event=await loadEvent(slug);
  if(!event) notFound();
  const user=await currentUser(),canManage=eventAbility(user?.profile?.id,event.members,managesSchool(user,event.schoolProfileId)).can('manage','Event');
  // Drafts and events hidden by moderation exist only for their organizers.
  if(!isPublic(event)&&!canManage) notFound();
  const t=await getTranslations('App'),x=await getTranslations('EventsX');
  const {going,interested,visible,own,attendees}=await listAttendees(event,user?.profile?.id);
  const date=(value:Date)=>new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:event.timezone}).format(value);
  const now=new Date(),nextDates=event.occurrences.filter(o=>!o.cancelled&&o.startsAt>=now);
  const selected=pickOccurrence(event,(await searchParams).date,now);
  const startsAt=selected?.startsAt||event.startsAt,endsAt=selected?.endsAt||event.endsAt;
  const isPast=(endsAt||startsAt)<now,dateCancelled=!!selected?.cancelled&&event.status!=='CANCELLED';
  const venue=event.venue&&!event.venue.hiddenAt?event.venue:null;
  const people=(roles:string[])=>event.members.filter(m=>roles.includes(m.role)&&!m.profile.hiddenAt).map(m=>m.profile)
    .filter((profile,index,all)=>all.findIndex(other=>other.id===profile.id)===index);
  const organizers=people(['OWNER','CO_ORGANIZER']),artists=people(['ARTIST']);
  const links=eventLinks(slug,locale,event.shortCode);
  const jsonLd=eventJsonLd(event,{startsAt,endsAt,cancelled:!!selected?.cancelled},{organizers,artists},{origin:links.origin,url:links.canonical});
  return <main className="detail-page event-page"><Link href={'/'+locale+'/events'}>← {t('back')}</Link>
    {isPublic(event)&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJson(jsonLd)}}/>}
    <div className="tags">{event.styles.map(({style})=><span key={style.id}>{style.name}</span>)}<span>{t('kind_'+event.kind)}</span><span>{t(event.status)}</span>{event.hiddenAt&&<span>{x('hiddenBadge')}</span>}</div>
    <h1>{event.title}</h1>
    {event.status==='CANCELLED'&&<p className="notice cancelled-notice" role="status">{t('cancelledText')}</p>}
    {dateCancelled&&<p className="notice cancelled-notice" role="status">{x('dateCancelledText')}</p>}
    {isPast&&event.status!=='CANCELLED'&&<p className="notice">{t('pastText')}</p>}
    <div className="event-facts"><div><h2>{t('time')}</h2>
      <p className={event.status==='CANCELLED'||dateCancelled?'struck':undefined}><time dateTime={startsAt.toISOString()}>{date(startsAt)}</time>{endsAt&&<> — <time dateTime={endsAt.toISOString()}>{date(endsAt)}</time></>}</p>
      <small>{x('eventZone',{zone:event.timezone,name:zoneName(startsAt,locale,event.timezone)})}</small>
      <ViewerTime startsAt={startsAt.toISOString()} endsAt={endsAt?.toISOString()} eventZone={event.timezone}/>
      {isPublic(event)&&<AddToCalendar eventId={event.id} title={event.title} startsAt={startsAt.toISOString()} endsAt={endsAt?.toISOString()} timezone={event.timezone}
        location={[venue?.name,venue?.address,event.city.name].filter(Boolean).join(', ')} details={(event.description||'').slice(0,500)} url={links.canonical}/>}
    </div>
    <div><h2>{t('location')}</h2>
      {venue?<><p><strong>{venue.name}</strong></p><p>{venue.address}</p><p>{event.city.name}</p></>:<p>{event.city.name}</p>}
      {event.priceText&&<><h2>{x('price')}</h2><p>{event.priceText}</p></>}
    </div></div>
    {/* A venue is shown exactly; an event without one sits at the city's coordinates. */}
    {event.lat!==null&&event.lng!==null&&<LocationMap lat={event.lat} lng={event.lng} label={venue?venue.name+', '+venue.address:event.city.name}/>}
    <h2>{t('classification')}</h2><dl className="class-facts">
      <div><dt>{t('kind')}</dt><dd>{t('kind_'+event.kind)}</dd></div>
      <div><dt>{t('format')}</dt><dd>{t('format_'+event.format)}</dd></div>
      <div><dt>{t('classLevel')}</dt><dd>{t('level_'+event.level)}</dd></div>
      <div><dt>{t('intensity')}</dt><dd>{t('intensity_'+event.intensity)}</dd></div>
      <div><dt>{t('tempo')}</dt><dd>{t('tempo_'+event.tempo)}</dd></div>
    </dl>
    {event.format!=='SOLO'&&event.partnerRequired!==null&&<p className="notice">{t(event.partnerRequired?'partnerRequired':'noPartnerNeeded')}</p>}
    <div className="tags">{event.tags.map(({tag})=><Link key={tag.id} href={'/'+locale+'/events?tag='+encodeURIComponent(tag.id)}>{t.has('tag_'+tag.id)?t('tag_'+tag.id):tag.name}</Link>)}</div>
    <h2>{t('description')}</h2><p className="prose">{event.description}</p>
    {event.prerequisites&&<><h2>{t('prerequisites')}</h2><p className="prose">{event.prerequisites}</p></>}
    {event.rrule&&<details className="session-list" open><summary>{t('nextSessions')} · {t('sessionCount',{count:event.occurrences.length})}</summary><ol>{event.occurrences.map(o=><li key={o.id}>
      <Link aria-current={o.id===selected?.id?'date':undefined} href={'?date='+encodeURIComponent(o.startsAt.toISOString())}>{o.cancelled?<s>{date(o.startsAt)}</s>:date(o.startsAt)}</Link>
      {o.cancelled&&<span className="badge">{t('CANCELLED')}</span>}</li>)}</ol></details>}
    <h2>{x('organizers')}</h2>
    <ul className="people-list">{organizers.map(p=><li key={p.id}><Link href={'/'+locale+'/@'+p.handle}>{p.name}</Link></li>)}</ul>
    {artists.length>0&&<><h2>{x('artists')}</h2>
      <ul className="people-list">{artists.map(p=><li key={p.id}><Link href={'/'+locale+'/@'+p.handle}>{p.name}</Link><span className="badge">{t(p.type)}</span></li>)}</ul></>}
    <EventMedia eventId={event.id} canManage={canManage}/>
    {isPublic(event)&&<EventPosts eventId={event.id}/>}
    {canManage&&<Link className="button secondary" href={'/'+locale+'/events/'+slug+'/edit'}>{x('manageEvent')}</Link>}
    <section className="rsvp-panel" aria-labelledby="rsvp-title"><h2 id="rsvp-title">{t('rsvpTitle')}</h2>
      <p className="rsvp-count">{t('goingCount',{count:going})} · {t('interestedCount',{count:interested})}</p>
      {event.rrule&&<p>{t('seriesRsvp')}</p>}
      {event.status==='PUBLISHED'&&!event.hiddenAt&&nextDates.length>0&&(user?.profile?<RsvpButtons eventId={event.id} initial={own||''}/>:<Link className="button" href={'/'+locale+(user?'/profile':'/login')}>{t(user?'profileRequired':'signInRsvp')}</Link>)}
      <h3>{x('attendees')}</h3>
      {!visible?<p className="field-note">{x('attendeesHidden_'+event.attendeeVisibility)}</p>:attendees.length===0?<p className="field-note">{x('noAttendees')}</p>:
        <ul className="attendee-list">{attendees.map(a=><li key={a.handle}><Link href={'/'+locale+'/@'+a.handle}>{a.name}</Link><span className="badge">{t(a.status==='GOING'?'going':'interested')}</span></li>)}</ul>}
      {visible&&event.attendeeVisibility!=='PUBLIC'&&<p className="field-note">{x('attendeesNote_'+event.attendeeVisibility)}</p>}
      {isPublic(event)&&event.status==='PUBLISHED'&&(canManage||!!own)&&<RoomLink eventId={event.id} signedIn={!!user}/>}
    </section>
    {isPublic(event)&&<section className="share-panel" aria-labelledby="share-title"><h2 id="share-title">{x('shareTitle')}</h2>
      <ShareButtons url={links.short} title={event.title} text={date(startsAt)+' · '+(venue?venue.name+', ':'')+event.city.name}/>
      {event.status==='PUBLISHED'&&<details className="event-share"><summary>{t('shareEvent')} ↗</summary><p>{t('selectedDate')}</p><AnnouncementStudio key={startsAt.toISOString()} initial={{title:event.title,date:date(startsAt)+' · '+event.timezone,place:(venue?venue.name+', ':'')+event.city.name,text:event.styles.map(s=>s.style.name).join(' · ')+' · '+t('kind_'+event.kind)}} urlPath={'/'+locale+'/events/'+slug+'?date='+encodeURIComponent(startsAt.toISOString())}/></details>}
    </section>}
    {isPublic(event)&&!canManage&&<ReportButton targetType="EVENT" targetId={event.id} signedIn={!!user}/>}
  </main>;
}
