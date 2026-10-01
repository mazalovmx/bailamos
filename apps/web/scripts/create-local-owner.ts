import {config} from 'dotenv';
import {randomBytes,randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import {db} from '@dance/db';
config({path:'../../.env',quiet:true});
async function main(){
  const host=new URL(process.env.DATABASE_URL||'').hostname;
  if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(host))throw new Error('Local database only');
  const email='owner@bailamos.test';
  if(await db.user.findUnique({where:{email}}))throw new Error('Owner already exists; password was not changed');
  const password=randomBytes(18).toString('base64url')+'!9aA',id=randomUUID(),hash=await hashPassword(password);
  await db.$transaction(async tx=>{
    await tx.user.create({data:{id,email,name:'Aleksandr',role:'OWNER',emailVerified:true,ageConfirmed:true,locale:'ru',
      accounts:{create:{id:randomUUID(),providerId:'credential',accountId:id,password:hash}},
      profile:{create:{handle:'bailamos-owner',name:'Aleksandr',type:'DANCER'}}}});
    await tx.auditLog.create({data:{actorUserId:id,action:'LOCAL_OWNER_BOOTSTRAP',targetType:'User',targetId:id}});
  });
  console.log(JSON.stringify({email,password}));
}
main().finally(()=>db.$disconnect());
