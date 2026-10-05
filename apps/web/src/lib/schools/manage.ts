import {db} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';

export async function createSchool(userId:string,input:unknown){
  const data=z.object({name:z.string().trim().min(2).max(80),handle:z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/),cityId:z.string().min(1)}).parse(input);
  return db.$transaction(async tx=>{
    const user=await tx.user.findUnique({where:{id:userId},include:{profile:true}});
    if(!user||user.bannedAt||!user.emailVerified)throw new ApiError('FORBIDDEN',403);
    if(!user.profile)throw new ApiError('PROFILE_REQUIRED',400);
    if(!await tx.city.count({where:{id:data.cityId}}))throw new ApiError('INVALID_INPUT',400);
    const school=await tx.profile.create({data:{...data,type:'SCHOOL',schoolAdmins:{create:{userId,canManageAdmins:true}}}});
    if(user.role==='USER')await tx.user.update({where:{id:userId},data:{role:'SCHOOL_ADMIN'}});
    return school;
  });
}
export async function grantSchoolAdmin(userId:string,schoolId:string,input:unknown){
  const {email,revoke}=z.object({email:z.email().toLowerCase(),revoke:z.boolean().default(false)}).parse(input);
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Profile" WHERE id=${schoolId} FOR UPDATE`;
    const school=await tx.profile.findFirst({where:{id:schoolId,type:'SCHOOL'}});
    const grant=await tx.schoolAdmin.findUnique({where:{userId_schoolProfileId:{userId,schoolProfileId:schoolId}}});
    if(!school||(school.userId!==userId&&!grant?.canManageAdmins))throw new ApiError('FORBIDDEN',403);
    const target=await tx.user.findUnique({where:{email}});
    if(!target||target.bannedAt)throw new ApiError('NOT_FOUND',404);
    const existing=await tx.schoolAdmin.findUnique({where:{userId_schoolProfileId:{userId:target.id,schoolProfileId:schoolId}}});
    if(target.id===userId||existing?.canManageAdmins||target.id===school.userId)throw new ApiError('FORBIDDEN',403);
    if(revoke)await tx.schoolAdmin.deleteMany({where:{userId:target.id,schoolProfileId:schoolId}});
    else{
      await tx.schoolAdmin.upsert({where:{userId_schoolProfileId:{userId:target.id,schoolProfileId:schoolId}},create:{userId:target.id,schoolProfileId:schoolId},update:{}});
      if(target.role==='USER')await tx.user.update({where:{id:target.id},data:{role:'SCHOOL_ADMIN'}});
    }
    await tx.auditLog.create({data:{actorUserId:userId,action:revoke?'SCHOOL_ADMIN_REVOKE':'SCHOOL_ADMIN_GRANT',targetType:'School',targetId:schoolId,data:{userId:target.id}}});
    return {ok:true};
  });
}
