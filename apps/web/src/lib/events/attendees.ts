import {db} from '@dance/db';
import {notify} from '../notify';
import {mailLocale} from '../mail';
export type Visibility='PUBLIC'|'ATTENDEES'|'ORGANIZERS';
export type Answer='GOING'|'INTERESTED'|'DECLINED';
const positive=(status?:string|null)=>status==='GOING'||status==='INTERESTED';
// The answer that counts for one date of a series: the one given for that date, else the one for the whole series.
export function effectiveAnswer(series?:Answer|null,override?:Answer|null):Answer|null {return override??series??null;}
// Who may read the attendee list. Counters are always public; names follow the organizer's setting.
export function canSeeAttendees(visibility:Visibility,viewer:{isManager:boolean;hasRsvp:boolean}) {
  if(viewer.isManager||visibility==='PUBLIC') return true;
  return visibility==='ATTENDEES'&&viewer.hasRsvp;
}
type Row={profileId:string;status:Answer;createdAt:Date};
// Everybody's answers: for the whole series and, when a date is named, for that date. `effective` is what counts there.
export async function dateAnswers(eventId:string,occurrenceId?:string|null) {
  const select={profileId:true,status:true,createdAt:true} as const;
  const [seriesRows,overrideRows]:[Row[],Row[]]=await Promise.all([db.rsvp.findMany({where:{eventId},select}),
    occurrenceId?db.occurrenceRsvp.findMany({where:{occurrenceId,occurrence:{eventId}},select}):[]]);
  const series=new Map(seriesRows.map(row=>[row.profileId,row])),overrides=new Map(overrideRows.map(row=>[row.profileId,row]));
  return {series,overrides,effective:new Map([...series,...overrides])};
}
// Profiles whose effective answer for that date (or, without a date, for the series) is one of the given ones.
export async function attendeeProfileIds(eventId:string,occurrenceId:string|null|undefined,statuses:readonly Answer[]) {
  const {effective}=await dateAnswers(eventId,occurrenceId);
  return [...effective.values()].filter(row=>statuses.includes(row.status)).map(row=>row.profileId);
}
// Everyone a cancellation of the whole event concerns: a positive answer for the series or for any date still ahead.
export async function eventAudience(eventId:string,now=new Date()) {
  const status={in:['GOING','INTERESTED'] as Answer[]};
  const [series,dates]=await Promise.all([db.rsvp.findMany({where:{eventId,status},select:{profileId:true}}),
    db.occurrenceRsvp.findMany({where:{status,occurrence:{eventId,cancelled:false,startsAt:{gte:now}}},select:{profileId:true}})]);
  return [...new Set([...series,...dates].map(row=>row.profileId))];
}
// Counters and names. With `occurrenceId` (one date of a series) everything is computed from the effective answers
// for that date; without it, from the answers for the whole event, as for a one-off event.
export async function listAttendees(event:{id:string;attendeeVisibility:Visibility;members:{profileId:string;role:string}[]},viewerProfileId?:string|null,occurrenceId?:string|null) {
  const {series,overrides,effective}=await dateAnswers(event.id,occurrenceId);
  const rows=[...effective.values()];
  const seriesOwn=viewerProfileId?series.get(viewerProfileId)?.status??null:null,override=viewerProfileId?overrides.get(viewerProfileId)?.status??null:null;
  const own=effectiveAnswer(seriesOwn,override);
  const isManager=!!viewerProfileId&&event.members.some(m=>m.profileId===viewerProfileId&&(m.role==='OWNER'||m.role==='CO_ORGANIZER'));
  // Whoever answered positively for the series keeps access to the list on a date they skip.
  const visible=canSeeAttendees(event.attendeeVisibility,{isManager,hasRsvp:positive(own)||positive(seriesOwn)});
  const listed=visible?rows.filter(row=>positive(row.status))
    .sort((a,b)=>(a.status===b.status?0:a.status==='GOING'?-1:1)||a.createdAt.getTime()-b.createdAt.getTime()).slice(0,400):[];
  const profiles=listed.length?new Map((await db.profile.findMany({where:{id:{in:listed.map(row=>row.profileId)},hiddenAt:null},select:{id:true,handle:true,name:true}})).map(p=>[p.id,p])):new Map<string,{handle:string;name:string}>();
  return {going:rows.filter(row=>row.status==='GOING').length,interested:rows.filter(row=>row.status==='INTERESTED').length,
    visible,visibility:event.attendeeVisibility,own,series:seriesOwn,override,
    attendees:listed.flatMap(row=>{const profile=profiles.get(row.profileId);return profile?[{handle:profile.handle,name:profile.name,status:row.status}]:[];}).slice(0,200)};
}
type EventRef={id:string;slug:string;title:string};
type ProfileRef={id:string;handle:string;name:string};
// Organizers hear about a new "going" once per attendee, however often that person changes their mind afterwards
// and whether the answer was for the series or for a single date.
async function announceAttendee(event:EventRef,profile:ProfileRef) {
  const organizers=await db.eventMembership.findMany({where:{eventId:event.id,role:{in:['OWNER','CO_ORGANIZER']},profileId:{not:profile.id}},
    select:{profile:{select:{userId:true,user:{select:{locale:true}}}}}});
  const users=organizers.flatMap(m=>m.profile.userId?[{id:m.profile.userId,locale:mailLocale(m.profile.user?.locale)}]:[]);
  if(!users.length) return;
  const told=await db.notification.findMany({where:{userId:{in:users.map(u=>u.id)},type:'NEW_ATTENDEE',
    AND:[{data:{path:['eventId'],equals:event.id}},{data:{path:['profileId'],equals:profile.id}}]},select:{userId:true}});
  const fresh=users.filter(u=>!told.some(n=>n.userId===u.id));
  // The link opens in each organizer's own interface language.
  for(const locale of new Set(fresh.map(u=>u.locale)))
    await notify(fresh.filter(u=>u.locale===locale).map(u=>u.id),'NEW_ATTENDEE',
      {eventId:event.id,slug:event.slug,title:event.title,name:profile.name,handle:profile.handle,profileId:profile.id},'/'+locale+'/events/'+event.slug);
}
// Records an answer for the whole event. "DECLINED" withdraws it; answers given for single dates stay as they are.
export async function setRsvp(event:EventRef,profile:ProfileRef,status:Answer) {
  const where={eventId_profileId:{eventId:event.id,profileId:profile.id}};
  if(status==='DECLINED') await db.rsvp.deleteMany({where:{eventId:event.id,profileId:profile.id}});
  else await db.rsvp.upsert({where,create:{eventId:event.id,profileId:profile.id,status},update:{status}});
  if(status==='GOING') await announceAttendee(event,profile);
}
// Records an answer for one date of a series; it overrides the series-wide answer for that date only.
// "DECLINED" means "not this date" and is kept; `null` removes the override, so the series answer counts again.
export async function setOccurrenceRsvp(event:EventRef,occurrenceId:string,profile:ProfileRef,status:Answer|null) {
  if(!status) await db.occurrenceRsvp.deleteMany({where:{occurrenceId,profileId:profile.id}});
  else await db.occurrenceRsvp.upsert({where:{occurrenceId_profileId:{occurrenceId,profileId:profile.id}},create:{occurrenceId,profileId:profile.id,status},update:{status}});
  if(status==='GOING') await announceAttendee(event,profile);
}
