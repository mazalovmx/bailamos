import {db} from '@dance/db';
import {notify} from '../notify';
import {mailLocale} from '../mail';
export type Visibility='PUBLIC'|'ATTENDEES'|'ORGANIZERS';
// Who may read the attendee list. Counters are always public; names follow the organizer's setting.
export function canSeeAttendees(visibility:Visibility,viewer:{isManager:boolean;hasRsvp:boolean}) {
  if(viewer.isManager||visibility==='PUBLIC') return true;
  return visibility==='ATTENDEES'&&viewer.hasRsvp;
}
export async function listAttendees(event:{id:string;attendeeVisibility:Visibility;members:{profileId:string;role:string}[]},viewerProfileId?:string|null) {
  const [going,interested,own]=await Promise.all([
    db.rsvp.count({where:{eventId:event.id,status:'GOING'}}),db.rsvp.count({where:{eventId:event.id,status:'INTERESTED'}}),
    viewerProfileId?db.rsvp.findUnique({where:{eventId_profileId:{eventId:event.id,profileId:viewerProfileId}}}):null]);
  const isManager=!!viewerProfileId&&event.members.some(m=>m.profileId===viewerProfileId&&(m.role==='OWNER'||m.role==='CO_ORGANIZER'));
  const visible=canSeeAttendees(event.attendeeVisibility,{isManager,hasRsvp:own?.status==='GOING'||own?.status==='INTERESTED'});
  const rows=visible?await db.rsvp.findMany({where:{eventId:event.id,status:{in:['GOING','INTERESTED']},profile:{hiddenAt:null}},
    orderBy:[{status:'asc'},{createdAt:'asc'}],take:200,select:{status:true,profile:{select:{handle:true,name:true}}}}):[];
  return {going,interested,visible,visibility:event.attendeeVisibility,own:own?.status??null,
    attendees:rows.map(r=>({handle:r.profile.handle,name:r.profile.name,status:r.status}))};
}
// Records an answer. "DECLINED" withdraws it. Organizers hear about a new "going" once per attendee,
// however often that person changes their mind afterwards.
export async function setRsvp(event:{id:string;slug:string;title:string},profile:{id:string;handle:string;name:string},status:'GOING'|'INTERESTED'|'DECLINED') {
  const where={eventId_profileId:{eventId:event.id,profileId:profile.id}};
  if(status==='DECLINED') await db.rsvp.deleteMany({where:{eventId:event.id,profileId:profile.id}});
  else await db.rsvp.upsert({where,create:{eventId:event.id,profileId:profile.id,status},update:{status}});
  if(status!=='GOING') return;
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
