import {db, assignSchoolMember} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';

export async function createSchool(userId:string,input:unknown){
  const data=z.strictObject({name:z.string().trim().min(2).max(80),handle:z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/),cityId:z.string().min(1)}).parse(input);
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
    const user=await tx.user.findUnique({where:{id:userId},include:{profile:true}});
    if(!user||user.bannedAt||!user.emailVerified)throw new ApiError('FORBIDDEN',403);
    if(!user.profile)throw new ApiError('PROFILE_REQUIRED',400);
    if(!await tx.city.count({where:{id:data.cityId}}))throw new ApiError('INVALID_INPUT',400);
    const school=await tx.profile.create({data:{...data,type:'SCHOOL',schoolAdmins:{create:{userId,canManageAdmins:true}}}});
    await tx.auditLog.create({data:{actorUserId:userId,action:'SCHOOL_CREATE',targetType:'School',targetId:school.id,data:{canManageAdmins:true}}});
    return school;
  });
}
export async function grantSchoolAdmin(userId:string,schoolId:string,input:unknown){
  const {email,revoke,role}=z.strictObject({email:z.string().trim().toLowerCase().pipe(z.email().max(254)),revoke:z.boolean().default(false),role:z.enum(['ADMIN','MANAGER']).default('ADMIN')}).parse(input);
  return assignSchoolMember(userId,schoolId,{email,revoke,canManageAdmins:role==='MANAGER'});
}
