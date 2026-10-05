import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {config} from 'dotenv';
import {db} from '@dance/db';
config({path:'../../.env',quiet:true});
const base=process.env.BETTER_AUTH_URL||'http://localhost:3000';
const mail='http://127.0.0.1:8025';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname), 'Workflow tests require a local server');
type Client={cookie:string;email:string;userId?:string;profileId?:string};
const tag=randomUUID().slice(0,8),password='Test-only-Strong-'+randomUUID();
const clients:Client[]=[{cookie:'',email:'owner-'+tag+'@example.test'},{cookie:'',email:'guest-'+tag+'@example.test'},{cookie:'',email:'co-'+tag+'@example.test'}];
const eventIds:string[]=[],stubProfileIds:string[]=[];
async function request(client:Client,path:string,body:unknown,method='POST'){
  if(method==='PATCH'&&/^\/api\/events\/[^/]+$/.test(path)&&body&&typeof body==='object'&&'title' in body){
    const event=await db.event.findUniqueOrThrow({where:{id:path.split('/').at(-1)}});body={...body,version:event.version};
  }
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:client.cookie},body:JSON.stringify(body),redirect:'manual'});
  const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]);
  if(cookies.length)client.cookie=cookies.join('; ');
  const data=await response.json();
  return {status:response.status,data};
}
async function mailLink(email:string,kind:'verify'|'reset'|'invite'){
  for(let i=0;i<30;i++){
    const inbox=await(await fetch(mail+'/api/v1/messages')).json();
    const message=inbox.messages.find((m:{To:{Address:string}[];Subject:string})=>m.To.some(to=>to.Address===email)&&m.Subject.includes({verify:'Confirm',reset:'Reset',invite:'Invitation'}[kind]));
    if(message){
      const detail=await(await fetch(mail+'/api/v1/message/'+message.ID)).json();
      const url=detail.Text.match(/https?:\/\/\S+/)?.[0];
      if(url)return {url,messageId:message.ID as string};
    }
    await setTimeout(250);
  }
  throw new Error('Local verification email was not received');
}
test('real users: verification, profiles, draft privacy, permissions, publication, RSVP, weekly party with team and artists, reset', {timeout:180000},async()=>{
  try{
    const age=await request(clients[0],'/api/auth/sign-up/email',{name:'Too young',email:'age-'+tag+'@example.test',password,ageConfirmed:false,locale:'en'});
    assert.equal(age.status,400);
    for(const [index,client]of clients.entries()){
      const signup=await request(client,'/api/auth/sign-up/email',{name:'Test dancer '+index,email:client.email,password,ageConfirmed:true,locale:'en',callbackURL:base+'/en/profile'});
      assert.equal(signup.status,200,JSON.stringify(signup.data));
      client.userId=signup.data.user.id;
      const unverified=await request(client,'/api/profile',{},'PUT');
      assert.ok([401,403].includes(unverified.status));
      const {url,messageId}=await mailLink(client.email,'verify');
      const verification=await fetch(url,{redirect:'manual'});
      assert.ok(verification.status<400);
      await fetch(mail+'/api/v1/messages',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({IDs:[messageId]})});
      const login=await request(client,'/api/auth/sign-in/email',{email:client.email,password});
      assert.equal(login.status,200,JSON.stringify(login.data));
      const profile=await request(client,'/api/profile',{handle:'test-'+tag+'-'+index,name:'Test dancer '+index,bio:'Integration test',cityId:'madrid',type:'DANCER',styleId:'bachata',role:'BOTH',level:'BEGINNER'},'PUT');
      assert.equal(profile.status,200,JSON.stringify(profile.data));
      client.profileId=(await db.profile.findUniqueOrThrow({where:{userId:client.userId}})).id;
    }
    const [owner,guest,co]=clients;
    const input={title:'Integration dance '+tag,description:'A test event that will be removed after verification.',cityId:'madrid',styleId:'solo-jazz',startsLocal:'2030-06-14T19:00',endsLocal:'2030-06-14T22:00',status:'DRAFT',
      kind:'CLASS',format:'SOLO',level:'BEGINNER',intensity:'RELAXED',tempo:'SLOW',partnerRequired:false,tagIds:['musicality','footwork'],recurrenceWeeks:4,
      pin:{lat:40.4153,lng:-3.7074},address:'Plaza Mayor, by the statue',mapNote:'Meet at the statue. We dance on the east side.'};
    // An event without an exact marker is refused: a square or a park has no address to fall back on.
    const {pin:_pin,...noPlace}=input;void _pin;
    const refused=await request(owner,'/api/events',noPlace);
    assert.equal(refused.status,400);assert.equal(refused.data.error,'PLACE_REQUIRED');
    const wordy=await request(owner,'/api/events',{...input,mapNote:'One. Two. Three sentences are too many.'});
    assert.equal(wordy.status,400);
    const created=await request(owner,'/api/events',input);
    assert.equal(created.status,201,JSON.stringify(created.data));
    const event=await db.event.findUniqueOrThrow({where:{slug:created.data.slug}});
    eventIds.push(event.id);
    assert.equal(await db.eventOccurrence.count({where:{eventId:event.id}}),4);
    assert.equal((await fetch(base+'/en/events/'+event.slug)).status,404);
    const forbidden=await request(guest,'/api/events/'+event.id,{...input,status:'PUBLISHED'},'PATCH');
    assert.equal(forbidden.status,403);
    const draftRsvp=await request(guest,'/api/events/'+event.id+'/rsvp',{status:'GOING'},'PUT');
    assert.equal(draftRsvp.status,400);
    const published=await request(owner,'/api/events/'+event.id,{...input,status:'PUBLISHED'},'PATCH');
    assert.equal(published.status,200,JSON.stringify(published.data));
    const publicPage=await fetch(base+'/es/events/'+event.slug);
    assert.equal(publicPage.status,200);
    assert.ok((await publicPage.text()).includes(input.title));
    const filtered=await fetch(base+'/en/events?city=madrid&style=swing&format=SOLO&kind=CLASS&level=BEGINNER&intensity=RELAXED&tempo=SLOW&tag=musicality&recurring=1&noPartner=1&q='+tag);
    assert.ok((await filtered.text()).includes(input.title));
    const multiple=await fetch(base+'/en/events?city=moscow&city=madrid&kind=WORKSHOP&kind=CLASS&style=lindy-hop&style=solo-jazz&q='+tag);
    assert.ok((await multiple.text()).includes(input.title),'Repeated filter values must include a match in any selected option');
    for(const mismatch of ['format=PARTNER','intensity=ENERGETIC','tempo=FAST','style=lindy-hop','tag=connection']){
      const excluded=await fetch(base+'/en/events?'+mismatch+'&q='+tag);
      assert.equal((await excluded.text()).includes(input.title),false,mismatch);
    }
    for(let i=0;i<2;i++)assert.equal((await request(guest,'/api/events/'+event.id+'/rsvp',{status:'GOING'},'PUT')).status,200);
    assert.equal(await db.rsvp.count({where:{eventId:event.id,status:'GOING'}}),1);
    assert.equal((await request(guest,'/api/events/'+event.id+'/rsvp',{status:'INTERESTED'},'PUT')).status,200);
    assert.equal(await db.rsvp.count({where:{eventId:event.id,status:'GOING'}}),0);
    const crossOrigin=await fetch(base+'/api/events',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid',Cookie:owner.cookie},body:JSON.stringify(input)});
    assert.equal(crossOrigin.status,403);

    // E4 "done when": an organizer creates a weekly party, adds a co-organizer and an artist, attendees RSVP,
    // and the event is shown correctly to a viewer in another time zone.
    const party={title:'Weekly swing party '+tag,description:'Every Friday and Saturday: social dancing with a live band.',cityId:'madrid',styleId:'lindy-hop',
      startsLocal:'2031-06-06T21:00',endsLocal:'2031-06-07T01:00',status:'PUBLISHED',kind:'SOCIAL',format:'PARTNER',level:'OPEN',partnerRequired:false,tagIds:['live-music'],
      recurrenceWeeks:6,recurrenceDays:['FR','SA'],priceText:'10 €',attendeeVisibility:'ATTENDEES',pin:{lat:40.4203,lng:-3.7058}};
    const createdParty=await request(owner,'/api/events',party);
    assert.equal(createdParty.status,201,JSON.stringify(createdParty.data));
    assert.match(createdParty.data.shortCode,/^[a-z2-7]{6,8}$/);
    const weekly=await db.event.findUniqueOrThrow({where:{slug:createdParty.data.slug},include:{occurrences:{orderBy:{startsAt:'asc'}}}});
    eventIds.push(weekly.id);
    assert.equal(weekly.rrule,'FREQ=WEEKLY;BYDAY=FR,SA;COUNT=6');
    // 21:00 in Madrid in June is 19:00 UTC; the series alternates Friday and Saturday.
    assert.deepEqual(weekly.occurrences.slice(0,3).map(o=>o.startsAt.toISOString()),['2031-06-06T19:00:00.000Z','2031-06-07T19:00:00.000Z','2031-06-13T19:00:00.000Z']);
    // Co-organizer: invited by handle, accepts through the emailed link, may edit but neither delete nor change the team.
    assert.equal((await request(guest,'/api/events/'+weekly.id+'/invites',{handle:'test-'+tag+'-2'})).status,403);
    const invited=await request(owner,'/api/events/'+weekly.id+'/invites',{handle:'test-'+tag+'-2'});
    assert.equal(invited.status,201,JSON.stringify(invited.data));
    assert.equal('token' in invited.data,false);
    assert.equal(await db.notification.count({where:{userId:co.userId,type:'EVENT_INVITE'}}),1);
    // An email invitation answers the same whether or not the address has an account.
    for(const email of [guest.email,'nobody-'+tag+'@example.test']){
      const byEmail=await request(owner,'/api/events/'+weekly.id+'/invites',{email});
      assert.equal(byEmail.status,201);
      assert.deepEqual(Object.keys(byEmail.data).sort(),['email','expiresAt','handle','id']);
      assert.equal(byEmail.data.handle,null);
    }
    const inviteMail=await mailLink(co.email,'invite');
    const inviteToken=new URL(inviteMail.url).pathname.split('/').pop()!;
    assert.equal((await request(guest,'/api/invites/'+inviteToken,{action:'accept'})).status,403);
    assert.equal((await request(co,'/api/events/'+weekly.id,{...party,title:party.title+' edited'},'PATCH')).status,403);
    assert.equal((await request(co,'/api/invites/'+inviteToken,{action:'accept'})).status,200);
    assert.equal((await request(co,'/api/invites/'+inviteToken,{action:'accept'})).status,404);
    assert.equal((await request(co,'/api/events/'+weekly.id,party,'PATCH')).status,200);
    assert.equal((await request(co,'/api/events/'+weekly.id,{},'DELETE')).status,403);
    assert.equal((await request(co,'/api/events/'+weekly.id+'/invites',{handle:'test-'+tag+'-1'})).status,403);
    // Artists: a profile without an owner created from the editor, and an existing profile by handle.
    const stub=await request(co,'/api/events/'+weekly.id+'/artists',{name:'The Test Orchestra '+tag,type:'ARTIST'});
    assert.equal(stub.status,201,JSON.stringify(stub.data));
    assert.equal(stub.data.stub,true);
    stubProfileIds.push(stub.data.profileId);
    assert.equal((await db.profile.findUniqueOrThrow({where:{id:stub.data.profileId}})).userId,null);
    assert.equal((await request(guest,'/api/events/'+weekly.id+'/artists',{name:'Intruder'})).status,403);
    // Attendees: the list is for people who RSVP'd; the counter is public; organizers hear about a new "going".
    const hiddenList=await(await fetch(base+'/api/events/'+weekly.id+'/attendees')).json();
    assert.deepEqual([hiddenList.visible,hiddenList.attendees],[false,[]]);
    assert.equal((await request(guest,'/api/events/'+weekly.id+'/rsvp',{status:'GOING'},'PUT')).data.going,1);
    const list=await(await fetch(base+'/api/events/'+weekly.id+'/attendees',{headers:{Cookie:guest.cookie}})).json();
    assert.deepEqual([list.going,list.visible,list.attendees.map((a:{handle:string})=>a.handle)],[1,true,['test-'+tag+'-1']]);
    assert.equal(await db.notification.count({where:{type:'NEW_ATTENDEE',userId:{in:[owner.userId!,co.userId!]},data:{path:['eventId'],equals:weekly.id}}}),2);
    // The public page: local time of the event, the exact instant for the viewer's own zone, artists, JSON-LD and sharing metadata.
    const page=await(await fetch(base+'/en/events/'+weekly.slug)).text();
    assert.ok(page.includes('The Test Orchestra '+tag));
    assert.ok(page.includes('/en/@'+stub.data.handle));
    assert.match(page,/Friday, June 6, 2031 at 9:00.PM/);
    assert.ok(page.includes('Europe/Madrid'));
    // The viewer's clock is computed in the browser from this instant: 19:00 UTC is 15:00 in New York, 04:00 next day in Tokyo.
    assert.ok(page.includes('2031-06-06T19:00:00.000Z'));
    assert.ok(page.includes('"startDate":"2031-06-06T21:00:00+02:00"'));
    assert.ok(page.includes('https://schema.org/EventScheduled'));
    assert.ok(page.includes('hrefLang="ru"')||page.includes('hreflang="ru"'));
    assert.ok(page.includes(base+'/e/'+createdParty.data.shortCode));
    const image=page.match(/property="og:image" content="([^"]+)"/)?.[1];
    assert.ok(image,'the page announces a preview image');
    const preview=await fetch(image!.replace(/&amp;/g,'&'));
    assert.equal(preview.status,200);
    assert.equal(preview.headers.get('content-type'),'image/png');
    const short=await fetch(base+'/e/'+createdParty.data.shortCode,{redirect:'manual',headers:{'Accept-Language':'ru-RU,ru;q=0.9,en;q=0.5'}});
    assert.equal(short.status,308);
    assert.equal(short.headers.get('location'),base+'/ru/events/'+weekly.slug);
    assert.equal((await fetch(base+'/e/aaaaaaa',{redirect:'manual'})).status,404);
    // One date is cancelled: it is struck through on the page and the attendee is notified once.
    const second=weekly.occurrences[1];
    for(let i=0;i<2;i++)assert.equal((await request(co,'/api/events/'+weekly.id+'/occurrences/'+second.id,{cancelled:true},'PATCH')).status,200);
    assert.equal(await db.notification.count({where:{userId:guest.userId,type:'EVENT_CANCELLED'}}),1);
    assert.match(await(await fetch(base+'/en/events/'+weekly.slug)).text(),/<s>Saturday, June 7, 2031/);
    assert.equal((await request(owner,'/api/events/'+weekly.id+'/occurrences/'+second.id,{cancelled:false},'PATCH')).data.cancelled,false);
    // The owner removes the co-organizer and finally deletes the event with everything attached.
    assert.equal((await request(owner,'/api/events/'+weekly.id+'/members/'+co.profileId,{},'DELETE')).status,200);
    assert.equal((await request(co,'/api/events/'+weekly.id,party,'PATCH')).status,403);
    // Deleting a live event tells the attendee as well (second notice).
    assert.equal((await request(owner,'/api/events/'+weekly.id,{},'DELETE')).status,200);
    assert.equal(await db.event.count({where:{id:weekly.id}}),0);
    assert.equal(await db.rsvp.count({where:{eventId:weekly.id}}),0);
    assert.equal((await fetch(base+'/en/events/'+weekly.slug)).status,404);
    assert.equal((await fetch(base+'/e/'+createdParty.data.shortCode,{redirect:'manual'})).status,404);
    assert.equal((await request(owner,'/api/events/'+event.id,{...input,status:'CANCELLED'},'PATCH')).status,200);
    // The guest was interested when this event was cancelled: a third notice, after the single date and the deleted party above.
    assert.equal(await db.notification.count({where:{userId:guest.userId,type:'EVENT_CANCELLED'}}),3);
    assert.equal((await request(guest,'/api/events/'+event.id+'/rsvp',{status:'GOING'},'PUT')).status,400);
    const reset=await request(owner,'/api/auth/request-password-reset',{email:owner.email,redirectTo:base+'/en/reset-password'});
    assert.equal(reset.status,200);
    const {url,messageId}=await mailLink(owner.email,'reset');
    const resetRedirect=await fetch(url,{redirect:'manual'});
    const token=new URL(resetRedirect.headers.get('location')!,base).searchParams.get('token');
    assert.ok(token);
    assert.equal((await request(owner,'/api/auth/reset-password',{token,newPassword:password+'new'})).status,200);
    assert.equal((await request(owner,'/api/events',input)).status,401);
    assert.equal((await request(owner,'/api/auth/sign-in/email',{email:owner.email,password:password+'new'})).status,200);
    assert.equal((await request(owner,'/api/auth/sign-out',{})).status,200);
    assert.equal((await request(owner,'/api/events',input)).status,401);
    await fetch(mail+'/api/v1/messages',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({IDs:[messageId]})});
  }finally{
    await db.event.deleteMany({where:{id:{in:eventIds}}});
    await db.profile.deleteMany({where:{id:{in:stubProfileIds},userId:null}});
    await db.user.deleteMany({where:{email:{in:clients.map(c=>c.email)}}});
    await db.$disconnect();
  }
});
