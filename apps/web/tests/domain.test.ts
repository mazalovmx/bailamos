import test from 'node:test';
import assert from 'node:assert/strict';
import {eventAbility} from '../src/lib/permissions';
import {eventTimes,profileSchema} from '../src/lib/validation';
import {schedule} from '../src/lib/schedule';
import {eventSearch} from '../src/lib/event-search';
import {queryParams} from '../src/lib/search-query';
import {additionalCities,additionalStyles} from '../../../packages/db/prisma/catalogue-additions';
import {DateTime} from 'luxon';
import {workerHeartbeat} from '../src/worker/health';
test('worker readiness rejects missing, malformed, stale and future heartbeats',()=>{
  const now=Date.parse('2026-10-01T12:00:00Z');
  for(const raw of [null,'broken','null','{}','{"at":42}',JSON.stringify({at:'invalid'}),JSON.stringify({at:'2026-10-01T11:58:30Z'}),JSON.stringify({at:'2026-10-01T12:01:00Z'})])assert.deepEqual(workerHeartbeat(raw,now),{status:'down'});
  assert.deepEqual(workerHeartbeat(JSON.stringify({at:'2026-10-01T11:59:40Z'}),now),{status:'ok',at:'2026-10-01T11:59:40.000Z'});
});
test('only this event owner and co-organizer can manage it',()=>{
  const members=[{profileId:'owner',role:'OWNER'},{profileId:'co',role:'CO_ORGANIZER'},{profileId:'guest',role:'ATTENDEE'}];
  assert.equal(eventAbility('owner',members).can('manage','Event'),true);
  assert.equal(eventAbility('co',members).can('manage','Event'),true);
  for(const id of ['guest','stranger',undefined]) assert.equal(eventAbility(id,members).can('manage','Event'),false);
});
test('new catalogue entries have unique identifiers, valid time zones and searchable Balboa variants',()=>{
  assert.equal(new Set(additionalCities.map(c=>c.id)).size,additionalCities.length);
  assert.equal(new Set(additionalStyles.map(s=>s[0])).size,additionalStyles.length);
  for(const city of additionalCities){assert.ok(Math.abs(city.lat)<=90&&Math.abs(city.lng)<=180);assert.doesNotThrow(()=>new Intl.DateTimeFormat('en',{timeZone:city.timezone}).format(new Date()));}
  assert.deepEqual(eventSearch({style:'balboa'}).styles,{some:{styleId:{in:['balboa','pure-balboa','bal-swing']}}});
});
test('weekly classes preserve local time across daylight-saving changes',()=>{
  const result=schedule('2026-10-18T19:00','2026-10-18T20:00','Europe/Madrid',3);
  assert.equal(result.rrule,'FREQ=WEEKLY;COUNT=3');
  assert.equal(result.occurrences.length,3);
  assert.deepEqual(result.occurrences.map(o=>o.startsAt.toISOString()),[
    '2026-10-18T17:00:00.000Z','2026-10-25T18:00:00.000Z','2026-11-01T18:00:00.000Z'
  ]);
  for(const occurrence of result.occurrences)assert.equal(DateTime.fromJSDate(occurrence.startsAt,{zone:'Europe/Madrid'}).hour,19);
  assert.throws(()=>schedule('2026-10-18T19:00','2026-10-18T20:00','Europe/Madrid',53));
});
test('swing search combines independent characteristics and includes style children',()=>{
  const filter=eventSearch({style:'charleston',format:'SOLO',level:'BEGINNER',intensity:'RELAXED',tempo:'FAST',kind:'WORKSHOP',tag:'musicality',noPartner:'1'});
  assert.deepEqual(filter.styles,{some:{styleId:{in:['charleston','solo-charleston','partner-charleston']}}});
  assert.deepEqual(filter.format,{in:['SOLO']});
  assert.deepEqual(filter.intensity,{in:['RELAXED']});
  assert.deepEqual(filter.tempo,{in:['FAST']});
  assert.equal(filter.status,'PUBLISHED');
  assert.equal(filter.partnerRequired,false);
});
test('multi-selection keeps OR within groups, AND across groups and repeated pagination parameters',()=>{
  const query={city:['madrid','moscow','madrid'],style:['charleston','solo-jazz'],kind:['CLASS','WORKSHOP','invalid'],tag:['musicality','footwork'],intensity:['RELAXED','ENERGETIC']};
  const filter=eventSearch(query);
  assert.deepEqual(filter.cityId,{in:['madrid','moscow']});
  assert.deepEqual(filter.kind,{in:['CLASS','WORKSHOP']});
  assert.deepEqual(filter.styles,{some:{styleId:{in:['charleston','solo-charleston','partner-charleston','solo-jazz']}}});
  assert.deepEqual(filter.tags,{some:{tagId:{in:['musicality','footwork']}}});
  assert.deepEqual(filter.intensity,{in:['RELAXED','ENERGETIC']});
  const params=queryParams({...query,page:'2'});
  assert.deepEqual(params.getAll('city'),['madrid','moscow']);
  assert.equal(params.get('page'),'2');
  assert.equal(eventSearch({kind:['invalid']}).kind,undefined);
});
test('local event times become UTC in the selected city timezone',()=>{
  const times=eventTimes('2030-06-14T19:00','2030-06-14T22:00','Europe/Madrid');
  assert.equal(times.startsAt.toISOString(),'2030-06-14T17:00:00.000Z');
});
test('rejects reversed, nonexistent and ambiguous local times',()=>{
  assert.throws(()=>eventTimes('2030-06-14T19:00','2030-06-14T18:00','Europe/Madrid'));
  assert.throws(()=>eventTimes('2026-03-29T02:30','2026-03-29T04:30','Europe/Madrid'));
  assert.throws(()=>eventTimes('2026-10-25T02:30','2026-10-25T04:30','Europe/Madrid'));
});
test('profile validation blocks invalid handles and ignores ownership input',()=>{
  const profile={handle:'dancer_01',name:'Test dancer',bio:'',cityId:'madrid',type:'DANCER',styleId:'bachata',role:'BOTH',level:'BEGINNER',userId:'attacker'};
  assert.equal('userId' in profileSchema.parse(profile),false);
  assert.equal(profileSchema.safeParse({...profile,handle:'<script>'}).success,false);
});
