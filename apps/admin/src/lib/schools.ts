import {randomUUID} from 'node:crypto';
import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {HttpError} from './errors';
type Tx=Prisma.TransactionClient;
const globalRole=(role:string)=>role==='OWNER'||role==='ADMIN';
export async function schoolAccess(userId:string,schoolId:string,tx:Tx=db){
  const user=await tx.user.findUnique({where:{id:userId},select:{role:true,bannedAt:true,emailVerified:true}});
  if(!user||user.bannedAt||!user.emailVerified)throw new HttpError('FORBIDDEN',403);
  if(!globalRole(user.role)&&(user.role!=='SCHOOL_ADMIN'||!await tx.schoolAdmin.findUnique({where:{userId_schoolProfileId:{userId,schoolProfileId:schoolId}}})))throw new HttpError('FORBIDDEN',403);
  const school=await tx.profile.findFirst({where:{id:schoolId,type:'SCHOOL'}});
  if(!school)throw new HttpError('NOT_FOUND',404);
  return school;
}
async function globalAccess(userId:string,tx:Tx){
  const user=await tx.user.findUnique({where:{id:userId}});
  if(!user||user.bannedAt||!user.emailVerified||!globalRole(user.role))throw new HttpError('FORBIDDEN',403);
}
export async function schoolList(userId:string){
  const user=await db.user.findUniqueOrThrow({where:{id:userId}});
  if(user.bannedAt||!user.emailVerified||!['OWNER','ADMIN','SCHOOL_ADMIN'].includes(user.role))throw new HttpError('FORBIDDEN',403);
  return db.profile.findMany({where:{type:'SCHOOL',...(!globalRole(user.role)?{schoolAdmins:{some:{userId}}}:{})},select:{id:true,name:true,handle:true},orderBy:{name:'asc'}});
}
export async function createSchool(userId:string,input:unknown){
  const data=z.object({name:z.string().trim().min(2).max(80),handle:z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/)}).strict().parse(input);
  return db.$transaction(async tx=>{await globalAccess(userId,tx);const school=await tx.profile.create({data:{...data,type:'SCHOOL'}});await audit(tx,userId,school.id,'SCHOOL_CREATE',school.id);return {id:school.id};});
}
async function audit(tx:Tx,userId:string,schoolId:string,action:string,id:string){await tx.auditLog.create({data:{actorUserId:userId,action,targetType:'School',targetId:id,data:{schoolProfileId:schoolId}}});}
export async function grantSchool(userId:string,schoolId:string,input:unknown){
  const {email,revoke}=z.object({email:z.email().toLowerCase(),revoke:z.boolean().default(false)}).strict().parse(input);
  return db.$transaction(async tx=>{
    await globalAccess(userId,tx);await schoolAccess(userId,schoolId,tx);
    const target=await tx.user.findUnique({where:{email}});
    if(!target)throw new HttpError('NOT_FOUND',404);
    if(globalRole(target.role)||target.bannedAt)throw new HttpError('FORBIDDEN',403);
    if(revoke)await tx.schoolAdmin.deleteMany({where:{userId:target.id,schoolProfileId:schoolId}});
    else{await tx.schoolAdmin.upsert({where:{userId_schoolProfileId:{userId:target.id,schoolProfileId:schoolId}},create:{userId:target.id,schoolProfileId:schoolId},update:{}});await tx.user.update({where:{id:target.id},data:{role:'SCHOOL_ADMIN'}});}
    await tx.session.deleteMany({where:{userId:target.id}});
    await audit(tx,userId,schoolId,revoke?'SCHOOL_ADMIN_REVOKE':'SCHOOL_ADMIN_GRANT',target.id);
    return {ok:true};
  });
}
export async function schoolResources(userId:string,schoolId:string){
  await schoolAccess(userId,schoolId);
  const where={schoolProfileId:schoolId};
  const [events,posts,venues,conversations,messages]=await Promise.all([
    db.event.findMany({where,select:{id:true,title:true,status:true,description:true},orderBy:{createdAt:'desc'},take:100}),
    db.post.findMany({where,select:{id:true,title:true,publishedAt:true,hiddenAt:true},orderBy:{createdAt:'desc'},take:100}),
    db.venue.findMany({where,select:{id:true,name:true,address:true,hiddenAt:true},take:100}),
    db.conversation.findMany({where,select:{id:true,title:true},take:100}),
    db.message.findMany({where:{conversation:where},select:{id:true,body:true,hiddenAt:true,conversationId:true},orderBy:{createdAt:'desc'},take:100})]);
  return {events,posts,venues,conversations,messages};
}
const resourceInput=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('event'),title:z.string().trim().min(2).max(200),description:z.string().max(10000).default(''),cityId:z.string().min(1),styleId:z.string().min(1),startsAt:z.iso.datetime(),endsAt:z.iso.datetime()}),
  z.object({kind:z.literal('post'),title:z.string().trim().min(2).max(200),body:z.string().min(1).max(10000)}),
  z.object({kind:z.literal('venue'),name:z.string().min(2).max(200),address:z.string().min(2).max(300),cityId:z.string().min(1),lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}),
  z.object({kind:z.literal('conversation'),title:z.string().min(2).max(200)})
]);
export async function createSchoolResource(userId:string,schoolId:string,input:unknown){
  const data=resourceInput.parse(input);
  return db.$transaction(async tx=>{
    await schoolAccess(userId,schoolId,tx);let id:string;
    if(data.kind==='event'){
      const startsAt=new Date(data.startsAt),endsAt=new Date(data.endsAt);
      if(endsAt<=startsAt)throw new HttpError('INVALID_INPUT',400);
      const city=await tx.city.findUnique({where:{id:data.cityId}});
      if(!city||!await tx.danceStyle.count({where:{id:data.styleId}}))throw new HttpError('INVALID_REFERENCE',400);
      const row=await tx.event.create({data:{title:data.title,description:data.description,slug:'school-'+randomUUID(),schoolProfileId:schoolId,cityId:city.id,timezone:city.timezone,lat:city.lat,lng:city.lng,startsAt,endsAt,kind:'CLASS',status:'DRAFT',styles:{create:{styleId:data.styleId}},members:{create:{profileId:schoolId,role:'OWNER'}},occurrences:{create:{startsAt,endsAt}}}});id=row.id;
    }else if(data.kind==='post'){
      const row=await tx.post.create({data:{schoolProfileId:schoolId,profileId:schoolId,title:data.title,slug:'school-'+randomUUID(),excerpt:data.body.slice(0,300),content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:data.body}]}]}}});id=row.id;
    }else if(data.kind==='venue'){
      const {kind,...fields}=data;void kind;
      const row=await tx.venue.create({data:{...fields,schoolProfileId:schoolId}});id=row.id;
    }else{const row=await tx.conversation.create({data:{title:data.title,kind:'GROUP',schoolProfileId:schoolId,members:{create:{profileId:schoolId,admin:true}}}});id=row.id;}
    await audit(tx,userId,schoolId,'SCHOOL_RESOURCE_CREATE',id);return {id};
  });
}
const changeSchema=z.object({kind:z.enum(['event','post','venue','conversation','message']),id:z.string().min(1),action:z.enum(['rename','publish','hide','restore','cancel','addMember','removeMember']),title:z.string().trim().min(2).max(200).optional(),profileId:z.string().optional()}).strict();
export async function changeSchoolResource(userId:string,schoolId:string,input:unknown){
  const data=changeSchema.parse(input);
  return db.$transaction(async tx=>{
    await schoolAccess(userId,schoolId,tx);
    const where={id:data.id,schoolProfileId:schoolId};
    const row=data.kind==='event'?await tx.event.findFirst({where}):data.kind==='post'?await tx.post.findFirst({where}):data.kind==='venue'?await tx.venue.findFirst({where}):data.kind==='conversation'?await tx.conversation.findFirst({where}):await tx.message.findFirst({where:{id:data.id,conversation:{schoolProfileId:schoolId}}});
    if(!row)throw new HttpError('NOT_FOUND',404);
    if(data.kind==='conversation'){
      if(data.action==='rename'&&data.title)await tx.conversation.update({where:{id:data.id},data:{title:data.title}});
      else if(['addMember','removeMember'].includes(data.action)&&data.profileId){
        const profile=await tx.profile.findUnique({where:{handle:data.profileId.replace(/^@/,'')},select:{id:true,hiddenAt:true}});
        if(!profile||profile.hiddenAt)throw new HttpError('NOT_FOUND',404);
        if(profile.id===schoolId)throw new HttpError('FORBIDDEN',403);
        const memberKey={conversationId:data.id,profileId:profile.id};
        if(data.action==='addMember')await tx.conversationMember.upsert({where:{conversationId_profileId:memberKey},create:{...memberKey,admin:false},update:{}});
        else await tx.conversationMember.deleteMany({where:memberKey});
      }else throw new HttpError('INVALID_INPUT',400);
    }else if(data.kind==='event'){
      if(data.action==='rename'&&data.title)await tx.event.update({where:{id:data.id},data:{title:data.title}});
      else if(['publish','cancel'].includes(data.action)){await tx.event.update({where:{id:data.id},data:{status:data.action==='publish'?'PUBLISHED':'CANCELLED'}});await tx.eventOccurrence.updateMany({where:{eventId:data.id},data:{cancelled:data.action==='cancel'}});}
      else if(['hide','restore'].includes(data.action))await tx.event.update({where:{id:data.id},data:{hiddenAt:data.action==='hide'?new Date():null}});
      else throw new HttpError('INVALID_INPUT',400);
    }else if(data.kind==='post'){
      if(data.action==='rename'&&data.title)await tx.post.update({where:{id:data.id},data:{title:data.title}});
      else if(data.action==='publish')await tx.post.update({where:{id:data.id},data:{publishedAt:new Date()}});
      else if(['hide','restore'].includes(data.action))await tx.post.update({where:{id:data.id},data:{hiddenAt:data.action==='hide'?new Date():null}});
      else throw new HttpError('INVALID_INPUT',400);
    }else if(['hide','restore'].includes(data.action)){
      const hiddenAt=data.action==='hide'?new Date():null;
      if(data.kind==='venue')await tx.venue.update({where:{id:data.id},data:{hiddenAt}});else await tx.message.update({where:{id:data.id},data:{hiddenAt}});
    }else if(data.kind==='venue'&&data.action==='rename'&&data.title)await tx.venue.update({where:{id:data.id},data:{name:data.title}});
    else throw new HttpError('INVALID_INPUT',400);
    await audit(tx,userId,schoolId,'SCHOOL_'+data.action.toUpperCase(),data.id);return {ok:true};
  });
}
