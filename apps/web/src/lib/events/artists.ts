import {randomBytes} from 'node:crypto';
import {db, Prisma} from '@dance/db';
import {ApiError} from '../api';
export const MAX_ARTISTS=30;
// Handle base from a display name: 3–22 of [a-z0-9-]; names in other scripts fall back to the profile type.
export function stubHandleBase(name:string,fallback='artist') {
  const base=name.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,22).replace(/-+$/,'');
  return base.length>=3?base:fallback;
}
export const stubHandle=(name:string,fallback?:string)=>stubHandleBase(name,fallback)+'-'+randomBytes(3).toString('hex');
type Target={handle:string}|{name:string;type:'ARTIST'|'SCHOOL'};
// Attaches an artist to the event: an existing public profile by handle, or a new profile without an owner
// (userId null) that the real artist or school can claim later.
export async function attachArtist(event:{id:string;cityId:string},target:Target) {
  if(await db.eventMembership.count({where:{eventId:event.id,role:'ARTIST'}})>=MAX_ARTISTS) throw new ApiError('ARTIST_LIMIT',400);
  let profile:{id:string;handle:string;name:string;type:string;userId:string|null}|null=null;
  if('handle' in target){
    const found=await db.profile.findUnique({where:{handle:target.handle},select:{id:true,handle:true,name:true,type:true,userId:true,hiddenAt:true}});
    if(!found||found.hiddenAt) throw new ApiError('PROFILE_NOT_FOUND',404);
    profile=found;
  }else{
    for(let attempt=0;attempt<5&&!profile;attempt++){
      try{
        profile=await db.profile.create({data:{userId:null,type:target.type,name:target.name,cityId:event.cityId,
          handle:stubHandle(target.name,target.type.toLowerCase())},select:{id:true,handle:true,name:true,type:true,userId:true}});
      }catch(error){
        if(!(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')) throw error;
      }
    }
    if(!profile) throw new ApiError('SERVER_ERROR',500);
  }
  await db.eventMembership.upsert({where:{eventId_profileId_role:{eventId:event.id,profileId:profile.id,role:'ARTIST'}},
    create:{eventId:event.id,profileId:profile.id,role:'ARTIST'},update:{}});
  return {profileId:profile.id,handle:profile.handle,name:profile.name,type:profile.type,stub:!profile.userId};
}
export async function detachArtist(eventId:string,profileId:string) {
  const removed=await db.eventMembership.deleteMany({where:{eventId,profileId,role:'ARTIST'}});
  if(!removed.count) throw new ApiError('NOT_FOUND',404);
  // A stub that was created for this event only and is used nowhere else would be an orphan: remove it.
  const profile=await db.profile.findUnique({where:{id:profileId},select:{userId:true,_count:{select:{memberships:true,posts:true,claims:true}}}});
  if(profile&&!profile.userId&&!profile._count.memberships&&!profile._count.posts&&!profile._count.claims) await db.profile.delete({where:{id:profileId}});
}
