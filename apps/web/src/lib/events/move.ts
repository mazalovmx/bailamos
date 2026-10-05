import {db,lockEvent,queueEventNotice} from '@dance/db';
import {ApiError} from '../api';
import {notify,type NotificationType} from '../notify';
import {mailLocale,sendMail,siteUrl,type MailLocale} from '../mail';
import {singleDate} from '../schedule';
import {mailText,mailDate} from './mail-text';
import {attendeeProfileIds} from './attendees';
export const MOVED_NOTIFICATION:NotificationType='EVENT_MOVED';
// Whether a date differs from what the series scheduled for it.
export const isMoved=(occurrence:{originalStartsAt:Date|null})=>!!occurrence.originalStartsAt;
type MovableEvent={id:string;timezone:string;startsAt:Date;endsAt:Date|null};
// Moves one date of a series to new wall-clock times in the event's zone. The start the series had scheduled is kept
// in `originalStartsAt`: it is the slot this row stands for when the series is saved again (see syncOccurrences).
// Moving a date back to its slot, with the usual length, makes it an ordinary date of the series again.
export async function moveOccurrence(event:MovableEvent,occurrenceId:string,input:{startsLocal:string;endsLocal:string},now=new Date(),actorId?:string) {
  const times=singleDate(input.startsLocal,input.endsLocal,event.timezone);
  return db.$transaction(async tx=>{
    const current=await lockEvent(tx,event.id);
    const rows=await tx.eventOccurrence.findMany({where:{eventId:event.id},select:{id:true,startsAt:true,endsAt:true,cancelled:true,originalStartsAt:true}});
    const row=rows.find(r=>r.id===occurrenceId);
    if(!row) throw new ApiError('NOT_FOUND',404);
    if(rows.length<2) throw new ApiError('NOT_A_SERIES',400);
    // A cancelled date is restored first; a date that has begun stays where it was.
    if(row.cancelled||row.startsAt<=now) throw new ApiError('DATE_UNAVAILABLE',400);
    if(times.startsAt<=now) throw new Error('INVALID_TIME');
    const start=times.startsAt.getTime(),slot=row.originalStartsAt??row.startsAt;
    // Neither on top of another date nor into the slot another moved date still stands for.
    if(rows.some(r=>r.id!==row.id&&(r.startsAt.getTime()===start||r.originalStartsAt?.getTime()===start))) throw new ApiError('DATE_TAKEN',409);
    const previous={startsAt:row.startsAt,endsAt:row.endsAt};
    if(start===row.startsAt.getTime()&&times.endsAt.getTime()===row.endsAt?.getTime()) return {changed:false,previous,occurrence:{...row,...times}};
    const usual=event.endsAt?event.endsAt.getTime()-event.startsAt.getTime():null;
    const back=start===slot.getTime()&&times.endsAt.getTime()-start===usual;
    const occurrence=await tx.eventOccurrence.update({where:{id:row.id},data:{...times,originalStartsAt:back?null:slot,
      // A reminder that already went out is sent again for the new, later start.
      ...(times.startsAt>row.startsAt?{reminderSentAt:null}:{})},
      select:{id:true,startsAt:true,endsAt:true,cancelled:true,originalStartsAt:true}});
    // Calendar exports take DTSTAMP, Last-Modified and the SEQUENCE of moved dates from the event's own timestamp.
    const updated=await tx.event.update({where:{id:event.id},data:{version:{increment:1}}});
    if(current.status==='PUBLISHED'&&!current.hiddenAt)await queueEventNotice(tx,updated,{type:'EVENT_MOVED',key:`event:${event.id}:${updated.version}:move`,occurrence,previous:previous.startsAt,exceptUserId:actorId});
    return {changed:true,previous,occurrence};
  });
}
// Tells everyone whose effective answer for that date is "going" or "interested" about the new time:
// an in-app notification for all of them and an email unless they switched event emails off.
export async function announceMove(eventId:string,occurrence:{id:string;startsAt:Date},previous:Date,options:{exceptUserId?:string}={}) {
  const event=await db.event.findUnique({where:{id:eventId},select:{id:true,slug:true,title:true,timezone:true,venue:{select:{name:true,hiddenAt:true}}}});
  if(!event) return {notified:0,mailed:0};
  const profileIds=await attendeeProfileIds(eventId,occurrence.id,['GOING','INTERESTED']);
  const users=(await db.user.findMany({where:{profile:{id:{in:profileIds}},bannedAt:null},
    select:{id:true,email:true,locale:true,notificationPreference:{select:{emailEvents:true}}}})).filter(u=>u.id!==options.exceptUserId);
  const path='/events/'+event.slug+'?date='+encodeURIComponent(occurrence.startsAt.toISOString());
  const data={eventId:event.id,slug:event.slug,title:event.title,occurrenceId:occurrence.id,startsAt:occurrence.startsAt.toISOString(),
    previous:previous.toISOString(),timezone:event.timezone,...(event.venue&&!event.venue.hiddenAt?{place:event.venue.name}:{})};
  const locales=new Map<MailLocale,typeof users>();
  for(const user of users) locales.set(mailLocale(user.locale),[...(locales.get(mailLocale(user.locale))||[]),user]);
  let mailed=0;
  for(const [locale,group] of locales){
    await notify(group.map(u=>u.id),MOVED_NOTIFICATION,data,'/'+locale+path);
    const t=mailText(locale);
    const text=t('mailDateMovedBody',{title:event.title,previous:mailDate(previous,locale,event.timezone),date:mailDate(occurrence.startsAt,locale,event.timezone)})
      +'\n\n'+siteUrl()+'/'+locale+path+'\n\n'+t('mailFooter');
    const sent=await Promise.all(group.filter(u=>u.notificationPreference?.emailEvents??true).map(u=>sendMail(u.email,t('mailDateMovedSubject',{title:event.title}),text)));
    mailed+=sent.filter(Boolean).length;
  }
  return {notified:users.length,mailed};
}
