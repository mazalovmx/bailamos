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
const clients:Client[]=[{cookie:'',email:'owner-'+tag+'@example.test'},{cookie:'',email:'guest-'+tag+'@example.test'}];
const eventIds:string[]=[];
async function request(client:Client,path:string,body:unknown,method='POST'){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:client.cookie},body:JSON.stringify(body),redirect:'manual'});
  const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]);
  if(cookies.length)client.cookie=cookies.join('; ');
  const data=await response.json();
  return {status:response.status,data};
}
async function mailLink(email:string,kind:'verify'|'reset'){
  for(let i=0;i<30;i++){
    const inbox=await(await fetch(mail+'/api/v1/messages')).json();
    const message=inbox.messages.find((m:{To:{Address:string}[];Subject:string})=>m.To.some(to=>to.Address===email)&&m.Subject.includes(kind==='verify'?'Confirm':'Reset'));
    if(message){
      const detail=await(await fetch(mail+'/api/v1/message/'+message.ID)).json();
      const url=detail.Text.match(/https?:\/\/\S+/)?.[0];
      if(url)return {url,messageId:message.ID as string};
    }
    await setTimeout(250);
  }
  throw new Error('Local verification email was not received');
}
test('two real users: verification, profiles, draft privacy, permissions, publication, RSVP, reset', {timeout:120000},async()=>{
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
    const [owner,guest]=clients;
    const input={title:'Integration dance '+tag,description:'A test event that will be removed after verification.',cityId:'madrid',styleId:'solo-jazz',startsLocal:'2030-06-14T19:00',endsLocal:'2030-06-14T22:00',status:'DRAFT',
      kind:'CLASS',format:'SOLO',level:'BEGINNER',intensity:'RELAXED',tempo:'SLOW',partnerRequired:false,tagIds:['musicality','footwork'],recurrenceWeeks:4};
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
    assert.equal((await request(owner,'/api/events/'+event.id,{...input,status:'CANCELLED'},'PATCH')).status,200);
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
    await db.user.deleteMany({where:{email:{in:clients.map(c=>c.email)}}});
    await db.$disconnect();
  }
});
