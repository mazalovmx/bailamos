import {db} from '@dance/db';
import {notify} from '../notify';
import {mailLocale,sendMail,siteUrl,type MailLocale} from '../mail';
import {mailText,mailDate} from './mail-text';
// Tells everyone who answered "going" or "interested" that the event (or one date of a series) is cancelled:
// an in-app notification for all of them and an email unless they switched event emails off.
// Callers invoke it once, on the transition into the cancelled state.
export async function announceCancellation(eventId:string,options:{occurrence?:{id:string;startsAt:Date};exceptUserId?:string;link?:boolean}={}) {
  const event=await db.event.findUnique({where:{id:eventId},select:{id:true,slug:true,title:true,timezone:true,startsAt:true,
    rsvps:{where:{status:{in:['GOING','INTERESTED']}},select:{profile:{select:{user:{select:{id:true,email:true,locale:true,bannedAt:true,
      notificationPreference:{select:{emailEvents:true}}}}}}}}}});
  if(!event) return {notified:0,mailed:0};
  const users=event.rsvps.flatMap(r=>r.profile.user?[r.profile.user]:[]).filter(u=>u.id!==options.exceptUserId&&!u.bannedAt);
  const {occurrence}=options,path='/events/'+event.slug+(occurrence?'?date='+encodeURIComponent(occurrence.startsAt.toISOString()):'');
  const data={eventId:event.id,slug:event.slug,title:event.title,
    ...(occurrence?{occurrenceId:occurrence.id,date:occurrence.startsAt.toISOString(),timezone:event.timezone}:{})};
  const locales=new Map<MailLocale,typeof users>();
  for(const user of users) locales.set(mailLocale(user.locale),[...(locales.get(mailLocale(user.locale))||[]),user]);
  let mailed=0;
  for(const [locale,group] of locales){
    // A deleted event has no page to link to.
    await notify(group.map(u=>u.id),'EVENT_CANCELLED',data,options.link===false?undefined:'/'+locale+path);
    const t=mailText(locale),when=mailDate(occurrence?.startsAt||event.startsAt,locale,event.timezone);
    const subject=t(occurrence?'mailDateCancelledSubject':'mailCancelledSubject',{title:event.title});
    const text=t(occurrence?'mailDateCancelledBody':'mailCancelledBody',{title:event.title,date:when})
      +(options.link===false?'':'\n\n'+siteUrl()+'/'+locale+path)+'\n\n'+t('mailFooter');
    const sent=await Promise.all(group.filter(u=>u.notificationPreference?.emailEvents??true).map(u=>sendMail(u.email,subject,text)));
    mailed+=sent.filter(Boolean).length;
  }
  return {notified:users.length,mailed};
}
