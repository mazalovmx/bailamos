import {loginPath} from '../../../../../lib/login-path';
import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../../lib/session';
import {managesSchool} from '../../../../../lib/schools/access';
import {eventAbility} from '../../../../../lib/permissions';
import {catalogue} from '../../../../../lib/catalogue';
import {localStamp,parseRecurrence} from '../../../../../lib/schedule';
import {pendingInvites} from '../../../../../lib/events/invites';
import {EventForm} from '../../../../../components/forms';
import {ExtendSeries} from '../../../../../components/events/extend-series';
import {EventActions,TeamPanel,ArtistPanel,OccurrencePanel} from '../../../../../components/events/manage';
import '../../../../styles/events.css';
export async function generateMetadata(){const t=await getTranslations('App');return {title:t('editEvent'),robots:{index:false,follow:false}};}
export default async function Edit({params,searchParams}:{params:Promise<{locale:string;slug:string}>;searchParams:Promise<{created?:string}>}) {
  const {locale,slug}=await params,user=await currentUser();
  if(!user) redirect(loginPath(locale, '/events/'+slug+'/edit'));
  const event=await db.event.findUnique({where:{slug},include:{styles:true,tags:true,occurrences:{orderBy:{startsAt:'asc'}},
    members:{include:{profile:{select:{id:true,handle:true,name:true,type:true,userId:true}}}}}});
  const ability=eventAbility(user.profile?.id,event?.members||[],managesSchool(user,event?.schoolProfileId));
  if(!event||!user.profile||!ability.can('manage','Event')) notFound();
  const canTeam=ability.can('team','Event');
  const [{cities,styles,tags},invites,t,x]=await Promise.all([catalogue(),
    canTeam?pendingInvites(event.id):[],getTranslations('App'),getTranslations('EventsX')]);
  const local=(d:Date)=>localStamp(d,event.timezone);
  const recurrence=parseRecurrence(event.rrule,event.timezone),now=new Date();
  const person=(role:string)=>event.members.filter(m=>m.role===role).map(m=>({profileId:m.profile.id,handle:m.profile.handle,name:m.profile.name,type:m.profile.type,stub:!m.profile.userId}));
  return <main className="form-page event-editor"><Link href={'/'+locale+'/events/'+slug}>← {x('viewEvent')}</Link><h1>{t('editEvent')}</h1>
    {(await searchParams).created&&<p className="notice" role="status">{x('createdNext')}</p>}
    {event.hiddenAt&&<p className="notice">{x('hiddenNotice')}</p>}
    <EventActions eventId={event.id} status={event.status} canDelete={ability.can('delete','Event')}/>
    {event.rrule&&<ExtendSeries eventId={event.id} version={event.version}/>}
    <section aria-labelledby="details-title"><h2 id="details-title">{x('details')}</h2>
    {event.rrule&&<p className="notice">{t('editSeries')}</p>}
    <EventForm id={event.id} cities={cities} styles={styles} tags={tags} selectedTags={event.tags.map(t=>t.tagId)}
      initial={{version:String(event.version),lat:!event.placeConfirmed||event.lat===null?'':String(event.lat),lng:!event.placeConfirmed||event.lng===null?'':String(event.lng),address:event.address||'',mapImageKey:event.mapImageKey||'',mapNote:event.mapNote||'',title:event.title,description:event.description||'',cityId:event.cityId,venueId:event.venueId||'',priceText:event.priceText||'',attendeeVisibility:event.attendeeVisibility,
      styleId:event.styles[0]?.styleId||'',status:event.status,startsLocal:local(event.startsAt),endsLocal:event.endsAt?local(event.endsAt):'',
      kind:event.kind,format:event.format,level:event.level,intensity:event.intensity,tempo:event.tempo,prerequisites:event.prerequisites||'',partnerRequired:String(event.partnerRequired),
      recurrenceCount:String(recurrence.until?1:recurrence.count),recurrenceInterval:String(recurrence.interval),recurrenceDays:recurrence.byDay.join(','),recurrenceUntil:recurrence.until||''}}/></section>
    {event.occurrences.length>1&&<OccurrencePanel eventId={event.id} timezone={event.timezone} occurrences={event.occurrences.map(o=>({id:o.id,startsAt:o.startsAt.toISOString(),startsLocal:local(o.startsAt),endsLocal:o.endsAt?local(o.endsAt):'',
      cancelled:o.cancelled,past:o.startsAt<now,original:o.originalStartsAt?.toISOString()??null}))}/>}
    <TeamPanel eventId={event.id} owner={person('OWNER')} coOrganizers={person('CO_ORGANIZER')} invites={invites} canTeam={canTeam} selfProfileId={user.profile.id}/>
    <ArtistPanel eventId={event.id} artists={person('ARTIST')}/>
    <p className="field-note">{x('mediaOnPage')}</p>
  </main>;
}
