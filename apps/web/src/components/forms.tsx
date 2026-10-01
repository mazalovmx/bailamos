'use client';
import {useLocale,useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import Link from 'next/link';
import {SwingFields} from './swing-fields';
import {ScheduleFields} from './events/schedule-fields';
import {EventLocation} from './geo/event-location';
type Options={id:string;name:string;timezone?:string;lat?:number;lng?:number}[];
type Fields=Record<string,string>;
async function submit(url:string,method:string,body:unknown) {
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || data.code || 'GENERIC');
  return data;
}
function useFormStatus() {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const t=useTranslations('App'),x=useTranslations('EventsX');
  // Error codes are looked up in App first, then in the events namespace.
  return {busy,setBusy,error,setError,
    feedback:error?<p role="alert" className="form-error">{t.has('error_'+error)?t('error_'+error):x.has('error_'+error)?x('error_'+error):t('error_GENERIC')}</p>:null};
}
function values(form:HTMLFormElement):Fields {return Object.fromEntries(new FormData(form)) as Fields;}
export function AuthForm({mode,token}:{mode:'login'|'register'|'forgot'|'reset';token?:string}) {
  const t=useTranslations('App'),locale=useLocale(),router=useRouter(),s=useFormStatus();
  const [done,setDone]=useState(false);
  const title={login:'loginTitle',register:'registerTitle',forgot:'forgotTitle',reset:'resetTitle'}[mode];
  return <section className="form-page narrow"><p className="eyebrow">DANCE COMMUNITY</p><h1>{t(title)}</h1>
    {mode==='register'&&<p className="intro">{t('registerText')}</p>}
    {mode==='login'&&<p className="intro">{t('loginText')}</p>}
    {done?<p className="notice" role="status">{t(mode==='register'?'checkEmail':mode==='forgot'?'resetSent':'passwordSaved')}</p>:
    <form onSubmit={async e=>{e.preventDefault();s.setError('');s.setBusy(true);const data=values(e.currentTarget);
      try {
        const origin=window.location.origin;
        if(mode==='register') await submit('/api/auth/sign-up/email','POST',{...data,ageConfirmed:data.ageConfirmed==='on',locale,callbackURL:origin+'/'+locale+'/profile'});
        if(mode==='login') {await submit('/api/auth/sign-in/email','POST',data);router.push('/'+locale+'/account');router.refresh();return;}
        if(mode==='forgot') await submit('/api/auth/request-password-reset','POST',{email:data.email,redirectTo:origin+'/'+locale+'/reset-password'});
        if(mode==='reset') await submit('/api/auth/reset-password','POST',{newPassword:data.password,token});
        setDone(true);
      } catch(error){s.setError(error instanceof Error?error.message:'GENERIC');}finally{s.setBusy(false);}
    }}>
      {mode==='register'&&<label>{t('name')}<input name="name" required minLength={2} maxLength={80} autoComplete="name"/></label>}
      {mode!=='reset'&&<label>{t('email')}<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>}
      {mode!=='forgot'&&<label>{t('password')}<input name="password" type="password" required minLength={mode==='login'?1:10} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'}/>{mode!=='login'&&<small>{t('passwordHint')}</small>}</label>}
      {mode==='register'&&<label className="checkbox"><input name="ageConfirmed" type="checkbox" required/>{t('age')}</label>}
      {s.feedback}<button className="button" disabled={s.busy}>{t(s.busy?'working':mode==='login'?'signIn':mode==='register'?'signUp':mode==='forgot'?'sendLink':'savePassword')}</button>
    </form>}
    <div className="form-links"><Link href={'/'+locale+(mode==='login'?'/register':'/login')}>{t(mode==='login'?'noAccount':'haveAccount')} {t(mode==='login'?'signUp':'signIn')}</Link>
    {mode==='login'&&<Link href={'/'+locale+'/forgot-password'}>{t('forgot')}</Link>}</div>
  </section>;
}
function Select({name,label,options,value}:{name:string;label:string;options:Options;value?:string}) {
  const t=useTranslations('App');
  return <label>{label}<select name={name} defaultValue={value||''} required><option value="">{t('choose')}</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
}
export function ProfileForm({cities,styles,initial}:{cities:Options;styles:Options;initial:Fields}) {
  const t=useTranslations('App'),locale=useLocale(),router=useRouter(),s=useFormStatus();
  const opts=(items:string[])=>items.map(id=>({id,name:t(id)}));
  return <form className="editor-form" onSubmit={async e=>{e.preventDefault();s.setBusy(true);s.setError('');
    try{const result=await submit('/api/profile','PUT',values(e.currentTarget));router.push('/'+locale+'/people/'+result.handle);router.refresh();}
    catch(error){s.setError(error instanceof Error?error.message:'GENERIC');}finally{s.setBusy(false);}
  }}>
    <div className="form-grid"><label>{t('name')}<input name="name" defaultValue={initial.name} required minLength={2} maxLength={80}/></label>
    <label>{t('handle')}<input name="handle" defaultValue={initial.handle} pattern="[a-z0-9][a-z0-9_-]{2,29}" required minLength={3} maxLength={30}/><small>{t('handleHint')}</small></label>
    <Select name="cityId" label={t('city')} options={cities} value={initial.cityId}/>
    <Select name="type" label={t('profileType')} options={opts(['DANCER','ORGANIZER','SCHOOL','VENUE','ARTIST'])} value={initial.type||'DANCER'}/></div>
    <label>{t('bio')}<textarea name="bio" defaultValue={initial.bio} maxLength={1000} rows={4}/></label>
    <div className="form-grid"><Select name="styleId" label={t('primaryStyle')} options={styles} value={initial.styleId}/>
    <Select name="role" label={t('role')} options={opts(['LEADER','FOLLOWER','BOTH'])} value={initial.role}/>
    <Select name="level" label={t('level')} options={opts(['NEWCOMER','BEGINNER','INTERMEDIATE','ADVANCED','PRO'])} value={initial.level}/></div>
    {s.feedback}<button className="button" disabled={s.busy}>{t(s.busy?'working':'saveProfile')}</button>
  </form>;
}
export function EventForm({cities,styles,initial,id,tags,selectedTags=[],schools=[]}:{cities:Options;styles:Options;initial:Fields;id?:string;tags:Options;selectedTags?:string[];schools?:Options}) {
  const t=useTranslations('App'),x=useTranslations('EventsX'),locale=useLocale(),router=useRouter(),s=useFormStatus();
  const [cityId,setCityId]=useState(initial.cityId||'');
  return <form className="editor-form" onSubmit={async e=>{e.preventDefault();s.setBusy(true);s.setError('');
    try{
      const data=new FormData(e.currentTarget);
      const body={...values(e.currentTarget),pin:data.get('pin')?JSON.parse(String(data.get('pin'))):null,tagIds:data.getAll('tagIds'),recurrenceDays:data.getAll('recurrenceDays'),partnerRequired:data.get('partnerRequired')==='on'};
      const result=await submit('/api/events'+(id?'/'+id:''),id?'PATCH':'POST',body);
      // A new event continues in the editor, where the team, the artists and single dates are managed.
      router.push('/'+locale+'/events/'+result.slug+(id?'':'/edit?created=1'));router.refresh();}
    catch(error){s.setError(error instanceof Error?error.message:'GENERIC');}finally{s.setBusy(false);}
  }}>
    <label>{t('title')}<input name="title" required minLength={3} maxLength={120} defaultValue={initial.title}/></label>
    <label>{t('description')}<textarea name="description" required minLength={10} maxLength={5000} rows={6} defaultValue={initial.description}/></label>
    <div className="form-grid"><label>{t('city')}<select name="cityId" required value={cityId} onChange={e=>setCityId(e.target.value)}><option value="">{t('choose')}</option>{cities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <Select name="styleId" label={t('style')} options={styles} value={initial.styleId}/></div>
    {/* The picker submits "venueId"; saving copies the venue's coordinates to the event, or the city's when there is none. */}
    {!id&&schools.length>0&&<label>{x('onBehalfOf')}<select name="schoolProfileId" defaultValue=""><option value="">{x('onBehalfOfMe')}</option>{schools.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><small>{x('onBehalfOfHint')}</small></label>}
    <EventLocation key={cityId} city={cities.find(c=>c.id===cityId)} initial={cityId===initial.cityId?initial:{}}/>
    <label>{x('price')}<input name="priceText" maxLength={120} defaultValue={initial.priceText} placeholder={x('pricePlaceholder')}/><small>{x('priceHint')}</small></label>
    <SwingFields initial={initial} tags={tags} selectedTags={selectedTags}/>
    <ScheduleFields initial={initial} zone={cities.find(c=>c.id===cityId)?.timezone}/>
    <div className="form-grid"><label>{x('attendeeVisibility')}<select name="attendeeVisibility" defaultValue={initial.attendeeVisibility||'PUBLIC'}>{['PUBLIC','ATTENDEES','ORGANIZERS'].map(value=><option key={value} value={value}>{x('visibility_'+value)}</option>)}</select><small>{x('attendeeVisibilityHint')}</small></label>
    <Select name="status" label={t('status')} value={initial.status||'DRAFT'} options={(id?['DRAFT','PUBLISHED','CANCELLED']:['DRAFT','PUBLISHED']).map(id=>({id,name:t(id)}))}/></div>
    {s.feedback}<button className="button" disabled={s.busy}>{t(s.busy?'working':'saveEvent')}</button>
  </form>;
}
export function RsvpButtons({eventId,initial}:{eventId:string;initial:string}) {
  const t=useTranslations('App'),router=useRouter(),s=useFormStatus();
  const [status,setStatus]=useState(initial==='DECLINED'?'':initial);
  // "Remove RSVP" is only offered once there is an answer to remove.
  const choices=[['GOING','going'],['INTERESTED','interested'],...(status?[['DECLINED','declined']]:[])];
  return <div><div className="rsvp-buttons">{choices.map(([value,label])=>
    <button key={value} type="button" className={status===value?'button':'button secondary'} aria-pressed={value==='DECLINED'?undefined:status===value} disabled={s.busy} onClick={async()=>{
      s.setBusy(true);s.setError('');
      try{await submit('/api/events/'+eventId+'/rsvp','PUT',{status:value});setStatus(value==='DECLINED'?'':value);router.refresh();}
      catch(error){s.setError(error instanceof Error?error.message:'GENERIC');}finally{s.setBusy(false);}
    }}>{t(label)}</button>)}</div>{s.feedback}</div>;
}
