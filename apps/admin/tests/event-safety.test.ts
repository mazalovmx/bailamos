import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db} from '@dance/db';
import {changeSchoolResource,createSchoolResource} from '../src/lib/schools';
config({path:'../../.env',quiet:true});
test('school status commands preserve date exceptions, queue once, and require a confirmed place',async()=>{
 const id='admin-fix-'+randomUUID(),city=id+'-city',school=id+'-school',manager=id+'-manager',guest=id+'-guest';let eventId='';
 try{
  await db.city.create({data:{id:city,slug:city,name:'Test city',countryCode:'ES',timezone:'Europe/Madrid',lat:40.4,lng:-3.7}});
  await db.profile.create({data:{id:school,handle:'school-'+randomUUID().slice(0,8),name:'School',type:'SCHOOL',cityId:city}});
  await db.user.create({data:{id:manager,name:'Manager',email:manager+'@example.test',emailVerified:true,role:'SCHOOL_ADMIN',schoolAdminships:{create:{schoolProfileId:school}}}});
  await db.user.create({data:{id:guest,name:'Guest',email:guest+'@example.test',emailVerified:true,profile:{create:{name:'Guest',handle:'guest-'+randomUUID().slice(0,8),cityId:city,type:'DANCER'}}}});
  const profile=await db.profile.findUniqueOrThrow({where:{userId:guest}}),start=new Date('2035-01-01T18:00:00Z');
  const event=await db.event.create({data:{title:'Safety',slug:id,cityId:city,schoolProfileId:school,startsAt:start,timezone:'Europe/Madrid',status:'PUBLISHED',placeConfirmed:true,occurrences:{create:[{startsAt:start},{startsAt:new Date(start.getTime()+86400000),cancelled:true}]},rsvps:{create:{profileId:profile.id,status:'GOING'}}},include:{occurrences:true}});eventId=event.id;
  for(let i=0;i<2;i++)await changeSchoolResource(manager,school,{kind:'event',id:event.id,action:'cancel'});
  assert.equal(await db.notification.count({where:{userId:guest,type:'EVENT_CANCELLED'}}),1);assert.equal(await db.eventDelivery.count({where:{userId:guest}}),1);
  await changeSchoolResource(manager,school,{kind:'event',id:event.id,action:'publish'});
  assert.equal(await db.eventOccurrence.count({where:{eventId:event.id,cancelled:true}}),1);assert.ok((await db.event.findUniqueOrThrow({where:{id:event.id}})).shortCode);
  await db.event.update({where:{id:event.id},data:{status:'DRAFT',placeConfirmed:false}});
  await assert.rejects(changeSchoolResource(manager,school,{kind:'event',id:event.id,action:'publish'}),/PLACE_REQUIRED/);
  await assert.rejects(createSchoolResource(manager,school,{kind:'event',title:'Unsafe legacy create',cityId:city,styleId:'lindy-hop',startsAt:start.toISOString(),endsAt:new Date(start.getTime()+3600000).toISOString()}),/USE_EVENT_EDITOR/);
 }finally{
  if(eventId)await db.event.deleteMany({where:{id:eventId}});
  await db.auditLog.deleteMany({where:{actorUserId:manager}});
  await db.user.deleteMany({where:{id:{in:[manager,guest]}}});
  await db.profile.deleteMany({where:{cityId:city}});
  await db.city.deleteMany({where:{id:city}});
  await db.$disconnect();
 }
});
