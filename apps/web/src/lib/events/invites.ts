import {randomBytes} from 'node:crypto';
import {db} from '@dance/db';
import {ApiError} from '../api';
import {notify} from '../notify';
import {mailLocale,sendMail,siteUrl} from '../mail';
import {mailText} from './mail-text';
export const INVITE_DAYS=14,MAX_PENDING_INVITES=20;
export type InviteState='PENDING'|'ACCEPTED'|'EXPIRED';
export function inviteState(invite:{acceptedAt:Date|null;expiresAt:Date},now=new Date()):InviteState {
  return invite.acceptedAt?'ACCEPTED':invite.expiresAt<=now?'EXPIRED':'PENDING';
}
export const newInviteToken=()=>randomBytes(32).toString('base64url');
export const inviteExpiry=(now=new Date())=>new Date(now.getTime()+INVITE_DAYS*86400000);
const tokenPattern=/^[A-Za-z0-9_-]{20,100}$/;
type Target={handle:string}|{email:string};
// Creates a co-organizer invitation. The answer for an email address is always the same, whether or not
// an account exists for it; only a public handle can be reported as unknown or as already on the team.
export async function createInvite(event:{id:string;slug:string;title:string},inviter:{profileId:string;name:string;locale?:string|null},target:Target,now=new Date()) {
  let recipient:{userId:string|null;email:string;locale:string|null;profileId:string|null;handle:string|null};
  if('handle' in target){
    const profile=await db.profile.findUnique({where:{handle:target.handle},select:{id:true,handle:true,hiddenAt:true,
      user:{select:{id:true,email:true,locale:true}},memberships:{where:{eventId:event.id,role:{in:['OWNER','CO_ORGANIZER']}},select:{role:true}}}});
    // Stub profiles have no owner who could accept.
    if(!profile||profile.hiddenAt||!profile.user) throw new ApiError('PROFILE_NOT_FOUND',404);
    if(profile.memberships.length) throw new ApiError('ALREADY_MEMBER',409);
    recipient={userId:profile.user.id,email:profile.user.email,locale:profile.user.locale,profileId:profile.id,handle:profile.handle};
  }else{
    const account=await db.user.findUnique({where:{email:target.email},select:{id:true,locale:true,emailVerified:true,bannedAt:true}});
    recipient={userId:account?.emailVerified&&!account.bannedAt?account.id:null,email:target.email,locale:account?.locale??inviter.locale??null,profileId:null,handle:null};
  }
  const same=recipient.profileId?{profileId:recipient.profileId}:{email:recipient.email};
  const invite=await db.$transaction(async tx=>{
    // A repeated invitation replaces the previous one; expired ones are swept on the way.
    await tx.eventInvite.deleteMany({where:{eventId:event.id,acceptedAt:null,OR:[same,{expiresAt:{lte:now}}]}});
    if(await tx.eventInvite.count({where:{eventId:event.id,acceptedAt:null}})>=MAX_PENDING_INVITES) throw new ApiError('INVITE_LIMIT',429);
    return tx.eventInvite.create({data:{eventId:event.id,role:'CO_ORGANIZER',token:newInviteToken(),invitedByProfileId:inviter.profileId,
      expiresAt:inviteExpiry(now),...(recipient.profileId?{profileId:recipient.profileId}:{email:recipient.email})}});
  });
  const locale=mailLocale(recipient.locale),path='/'+locale+'/invites/'+invite.token,t=mailText(locale);
  await sendMail(recipient.email,t('mailInviteSubject',{title:event.title}),
    t('mailInviteBody',{title:event.title,inviter:inviter.name,days:INVITE_DAYS})+'\n\n'+siteUrl()+path+'\n\n'+t('mailFooter'));
  if(recipient.userId) await notify([recipient.userId],'EVENT_INVITE',{eventId:event.id,slug:event.slug,title:event.title,inviter:inviter.name,role:'CO_ORGANIZER'},path);
  return {id:invite.id,token:invite.token,expiresAt:invite.expiresAt,handle:recipient.handle,email:recipient.profileId?null:recipient.email};
}
export async function findInvite(token:string) {
  if(!tokenPattern.test(token)) return null;
  return db.eventInvite.findUnique({where:{token},include:{event:{select:{id:true,slug:true,title:true,status:true,timezone:true,startsAt:true,city:{select:{name:true}}}}}});
}
type Invitee={id:string;email:string;emailVerified:boolean;profile:{id:string}|null};
// Whether this signed-in person is the one the invitation was addressed to.
export function inviteMatches(invite:{profileId:string|null;email:string|null},user:Invitee) {
  if(invite.profileId) return invite.profileId===user.profile?.id;
  return !!invite.email&&user.emailVerified&&invite.email===user.email.trim().toLowerCase();
}
// Accepting makes the invitee a co-organizer; declining removes the invitation. A token works once and
// only for its addressee: a profile invitation for that profile, an email invitation for that verified email.
export async function answerInvite(token:string,user:Invitee,action:'accept'|'decline',now=new Date()) {
  const invite=await findInvite(token);
  if(!invite||inviteState(invite,now)!=='PENDING') throw new ApiError('INVITE_INVALID',404);
  if(!inviteMatches(invite,user)) throw new ApiError('INVITE_MISMATCH',403);
  if(action==='decline'){
    await db.eventInvite.delete({where:{id:invite.id}});
    return {status:'DECLINED' as const,slug:invite.event.slug};
  }
  if(!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
  const profileId=user.profile.id;
  await db.$transaction(async tx=>{
    // The conditional update is the single-use guard against two parallel accepts.
    const claimed=await tx.eventInvite.updateMany({where:{id:invite.id,acceptedAt:null},data:{acceptedAt:now}});
    if(!claimed.count) throw new ApiError('INVITE_INVALID',404);
    const owner=await tx.eventMembership.findFirst({where:{eventId:invite.eventId,profileId,role:'OWNER'}});
    if(!owner) await tx.eventMembership.upsert({where:{eventId_profileId_role:{eventId:invite.eventId,profileId,role:'CO_ORGANIZER'}},
      create:{eventId:invite.eventId,profileId,role:'CO_ORGANIZER'},update:{}});
  });
  return {status:'ACCEPTED' as const,slug:invite.event.slug};
}
// Pending invitations for the owner's team panel. Tokens are never listed.
export async function pendingInvites(eventId:string,now=new Date()) {
  const invites=await db.eventInvite.findMany({where:{eventId,acceptedAt:null,expiresAt:{gt:now}},orderBy:{createdAt:'asc'},
    select:{id:true,email:true,profileId:true,expiresAt:true}});
  const profiles=await db.profile.findMany({where:{id:{in:invites.flatMap(i=>i.profileId?[i.profileId]:[])}},select:{id:true,handle:true,name:true}});
  return invites.map(i=>{
    const profile=profiles.find(p=>p.id===i.profileId);
    return {id:i.id,email:i.email,handle:profile?.handle??null,name:profile?.name??null,expiresAt:i.expiresAt.toISOString()};
  });
}
