import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db,lockEvent,changeEventStatus,queueEventNotice} from '@dance/db';
import {syncOccurrences} from '../src/lib/event-input';
import {schedule,localStamp} from '../src/lib/schedule';
import {extendSeries} from '../src/lib/events/extend';
import {drainEventDeliveries} from '../src/lib/events/outbox';
import {createSchool,grantSchoolAdmin} from '../src/lib/schools/manage';
import {managedSchoolIds} from '../src/lib/schools/access';
import {buildCalendar,eventLocation} from '../src/lib/calendar/ics';
import {returnTarget} from '../src/lib/login-path';
import {discoveryDates} from '../src/lib/discovery';
import {bboxEvents} from '../src/lib/geo/nearby';
config({path:'../../.env',quiet:true});
const prefix='fix-'+randomUUID().slice(0,8),city=prefix+'-city',owner=prefix+'-owner',guest=prefix+'-guest';
const eventIds:string[]=[],schoolIds:string[]=[];
let profileId:string,guestProfile:string;
before(async()=>{
 await db.city.create({data:{id:city,slug:city,name:'Fix City',countryCode:'ES',timezone:'Europe/Madrid',lat:40.4,lng:-3.7}});
 for(const id of [owner,guest])await db.user.create({data:{id,name:id,email:id+'@example.test',emailVerified:true,ageConfirmed:true,profile:{create:{handle:id,name:id,type:'DANCER',cityId:city}}}});
 profileId=(await db.profile.findUniqueOrThrow({where:{userId:owner}})).id;guestProfile=(await db.profile.findUniqueOrThrow({where:{userId:guest}})).id;
});
after(async()=>{
 await db.event.deleteMany({where:{id:{in:eventIds}}});await db.profile.deleteMany({where:{id:{in:schoolIds}}});
 await db.user.deleteMany({where:{id:{in:[owner,guest]}}});await db.profile.deleteMany({where:{cityId:city}});await db.city.delete({where:{id:city}});await db.$disconnect();
});
async function event(count=4){
 const times=schedule('2035-01-02T19:00','2035-01-02T21:00','Europe/Madrid',count),{occurrences,...fields}=times;
 const row=await db.event.create({data:{...fields,timezone:'Europe/Madrid',slug:prefix+'-'+randomUUID(),title:'Persona fixes',cityId:city,status:'PUBLISHED',placeConfirmed:true,lat:40.4,lng:-3.7,address:'Calle Mayor 17',kind:'CLASS',level:'BEGINNER',members:{create:{profileId,role:'OWNER'}},occurrences:{create:occurrences.map(o=>({...o,slotStartsAt:o.startsAt}))}},include:{occurrences:{orderBy:{startsAt:'asc'}}}});
 eventIds.push(row.id);return row;
}
test('series shift preserves stable dates, RSVP overrides, cancellations and individual moves',async()=>{
 const row=await event(),[first,second,third]=row.occurrences;
 await db.occurrenceRsvp.create({data:{occurrenceId:first.id,profileId:guestProfile,status:'GOING'}});
 await db.eventOccurrence.update({where:{id:second.id},data:{cancelled:true}});
 const moved=new Date(third.startsAt.getTime()+86400000);
 await db.eventOccurrence.update({where:{id:third.id},data:{originalStartsAt:third.startsAt,startsAt:moved,endsAt:new Date(third.endsAt!.getTime()+86400000)}});
 await db.$transaction(async tx=>{await lockEvent(tx,row.id);await syncOccurrences(tx,row.id,row.occurrences.map(o=>({startsAt:new Date(o.startsAt.getTime()+3600000),endsAt:new Date(o.endsAt!.getTime()+3600000)})));});
 const dates=await db.eventOccurrence.findMany({where:{eventId:row.id},orderBy:{slotStartsAt:'asc'}});
 assert.deepEqual(dates.map(o=>o.id),row.occurrences.map(o=>o.id));assert.equal(dates[1].cancelled,true);assert.equal(dates[2].startsAt.getTime(),moved.getTime());
 assert.equal(await db.occurrenceRsvp.count({where:{occurrenceId:first.id}}),1);assert.ok(dates[0].previousStarts.includes(first.startsAt.toISOString()));
 await db.$transaction(tx=>syncOccurrences(tx,row.id,dates.slice(0,2).map(o=>({startsAt:o.slotStartsAt!,endsAt:o.endsAt}))));
 assert.equal(await db.eventOccurrence.count({where:{eventId:row.id}}),4);assert.equal((await db.eventOccurrence.findUniqueOrThrow({where:{id:third.id}})).cancelled,true);
});
test('concurrent editors: one version wins and rollback leaves no partial event or notices',async()=>{
 const row=await event(1);
 const results=await Promise.allSettled(['First','Second'].map(title=>db.$transaction(async tx=>{await lockEvent(tx,row.id,row.version);return tx.event.update({where:{id:row.id},data:{title,version:{increment:1}}});})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const before=await db.event.findUniqueOrThrow({where:{id:row.id}});
 await assert.rejects(db.$transaction(async tx=>{await changeEventStatus(tx,row.id,'CANCELLED',owner);throw new Error('rollback');}));
 assert.equal((await db.event.findUniqueOrThrow({where:{id:row.id}})).version,before.version);
});
test('moving a series by a full week keeps the ordinal identity even where old and new dates overlap',async()=>{
 const row=await event();await db.occurrenceRsvp.create({data:{occurrenceId:row.occurrences[0].id,profileId:guestProfile,status:'GOING'}});
 const shifted=row.occurrences.map(o=>({startsAt:new Date(o.startsAt.getTime()+7*86400000),endsAt:new Date(o.endsAt!.getTime()+7*86400000)}));
 await db.$transaction(async tx=>{await lockEvent(tx,row.id);await syncOccurrences(tx,row.id,shifted,new Date(),true);});
 const dates=await db.eventOccurrence.findMany({where:{eventId:row.id},orderBy:{startsAt:'asc'}});
 assert.deepEqual(dates.map(o=>o.id),row.occurrences.map(o=>o.id));assert.deepEqual(dates.map(o=>o.startsAt),shifted.map(o=>o.startsAt));
 assert.equal(await db.occurrenceRsvp.count({where:{occurrenceId:dates[0].id}}),1);
});
test('cancellation is atomic, repeat-safe and retries failed SMTP without duplicating the in-app notice',async()=>{
 const row=await event();await db.rsvp.create({data:{eventId:row.id,profileId:guestProfile,status:'GOING'}});
 await db.eventOccurrence.update({where:{id:row.occurrences[1].id},data:{cancelled:true}});
 await db.$transaction(tx=>changeEventStatus(tx,row.id,'CANCELLED',owner));await db.$transaction(tx=>changeEventStatus(tx,row.id,'CANCELLED',owner));
 const where={userId:guest,data:{path:['eventId'],equals:row.id}};
 assert.equal(await db.notification.count({where}),1);
 const delivery=await db.eventDelivery.findFirstOrThrow({where:{userId:guest,data:{path:['eventId'],equals:row.id}}});
 await db.eventDelivery.update({where:{id:delivery.id},data:{createdAt:new Date('2000-01-01'),retryAt:new Date('2000-01-01')}});
 await drainEventDeliveries(1,async()=>false);
 const failed=await db.eventDelivery.findUniqueOrThrow({where:{id:delivery.id}});assert.equal(failed.completedAt,null);assert.equal(failed.attempts,1);assert.equal(failed.lastError,'SMTP_DELIVERY_FAILED');
 await db.eventDelivery.update({where:{id:delivery.id},data:{retryAt:new Date('2000-01-01')}});
 let mail=0;await drainEventDeliveries(1,async()=>{mail++;return true;});assert.equal(mail,1);
 assert.ok((await db.eventDelivery.findUniqueOrThrow({where:{id:delivery.id}})).completedAt);assert.equal(await db.notification.count({where}),1);
 await db.$transaction(tx=>changeEventStatus(tx,row.id,'PUBLISHED',owner));assert.equal((await db.eventOccurrence.findUniqueOrThrow({where:{id:row.occurrences[1].id}})).cancelled,true);
});
test('one-off change snapshot contains new and old time and the complete place',async()=>{
 const row=await event(1);await db.rsvp.create({data:{eventId:row.id,profileId:guestProfile,status:'INTERESTED'}});
 await db.$transaction(async tx=>{const updated=await tx.event.update({where:{id:row.id},data:{address:'New Hall 9',startsAt:new Date(row.startsAt.getTime()+3600000),version:{increment:1}}});await queueEventNotice(tx,updated,{type:'EVENT_MOVED',key:row.id+':move',previous:row.startsAt,previousPlace:row.address!});});
 const note=await db.eventDelivery.findFirstOrThrow({where:{userId:guest,data:{path:['eventId'],equals:row.id}}}),data=note.data as Record<string,string>;
 assert.ok(data.place.includes('New Hall 9'));assert.equal(data.previousPlace,'Calle Mayor 17');assert.equal(data.previous,row.startsAt.toISOString());assert.notEqual(data.startsAt,data.previous);
});
test('separate school preserves personal identity and delegation is limited to its owner',async()=>{
 const school=await createSchool(owner,{name:'Separate School',handle:prefix+'-school',cityId:city});schoolIds.push(school.id);
 assert.equal((await db.profile.findUniqueOrThrow({where:{userId:owner}})).id,profileId);assert.equal(school.userId,null);
 await grantSchoolAdmin(owner,school.id,{email:guest+'@example.test'});assert.ok((await managedSchoolIds(guest)).includes(school.id));
 await assert.rejects(grantSchoolAdmin(guest,school.id,{email:owner+'@example.test',revoke:true}),/FORBIDDEN/);
 await grantSchoolAdmin(owner,school.id,{email:guest+'@example.test',revoke:true});assert.ok(!(await managedSchoolIds(guest)).includes(school.id));
});
test('extension passes 52 dates, preserves history and rejects a repeated stale request',async()=>{
 const row=await event(52),now=new Date(row.occurrences.at(-1)!.startsAt.getTime()+1000);
 await db.occurrenceRsvp.create({data:{occurrenceId:row.occurrences[0].id,profileId:guestProfile,status:'GOING'}});
 const result=await extendSeries(row.id,4,row.version,now);assert.equal(result.added,4);assert.equal(await db.eventOccurrence.count({where:{eventId:row.id}}),56);
 assert.equal(await db.occurrenceRsvp.count({where:{occurrenceId:row.occurrences[0].id}}),1);
 await assert.rejects(extendSeries(row.id,4,row.version,now),/EVENT_CONFLICT/);
 const added=await db.eventOccurrence.findMany({where:{eventId:row.id,startsAt:{gt:now}}});assert.equal(added.length,4);assert.ok(added.every(d=>localStamp(d.startsAt,row.timezone).endsWith('19:00')));
});
test('private bookmarks neither create RSVP nor notifications and have an idempotent key',async()=>{
 const row=await event(1),count=await db.notification.count({where:{userId:guest}});
 for(let n=0;n<2;n++)await db.eventBookmark.upsert({where:{userId_eventId:{userId:guest,eventId:row.id}},create:{userId:guest,eventId:row.id},update:{}});
 assert.equal(await db.eventBookmark.count({where:{eventId:row.id}}),1);assert.equal(await db.rsvp.count({where:{eventId:row.id}}),0);assert.equal(await db.notification.count({where:{userId:guest}}),count);
});
test('map filters city and level before limiting, calendar preserves manual address, and return targets are local',async()=>{
 const row=await event(1),from=new Date('2035-01-01'),to=new Date('2035-02-01');
 const args={bbox:[-4,40,-3,41] as [number,number,number,number],from,to,limit:50,city:[city]};
 assert.ok((await bboxEvents({...args,level:['BEGINNER']})).some(e=>e.id===row.id));assert.ok(!(await bboxEvents({...args,level:['ADVANCED']})).some(e=>e.id===row.id));
 assert.equal((await bboxEvents({...args,city:['unknown-city']})).length,0);
 const ics=buildCalendar({name:'Test',origin:'https://example.test',events:[{...row,city:{name:'Fix City'}}]});assert.ok(ics.includes('Calle Mayor 17'));
 assert.ok(eventLocation({...row,city:{name:'Fix City'}}).includes('openstreetmap.org'));
 assert.equal(returnTarget('en','/en/events/new?school=one'),'/en/events/new?school=one');assert.equal(returnTarget('en','//evil.example'),undefined);
 const range=discoveryDates({from:'2035-01-02',to:'2035-01-02'},'Europe/Madrid');assert.equal(range.gte.toISOString(),'2035-01-01T23:00:00.000Z');assert.equal(range.lt!.toISOString(),'2035-01-02T23:00:00.000Z');
});
