'use client';
import {useLocale,useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useState} from 'react';

import {SwingFields} from './swing-fields';
import {ScheduleFields} from './events/schedule-fields';
import {EventPlace} from './events/event-place';
import {MapCardFields} from './events/map-card-fields';
type Options={id:string;name:string;timezone?:string;lat?:number;lng?:number;countryCode?:string}[];
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
function Select({name,label,options,value}:{name:string;label:string;options:Options;value?:string}) {
  const t=useTranslations('App');
  return <label>{label}<select name={name} defaultValue={value||''} required><option value="">{t('choose')}</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
}
export function EventForm({cities,styles,initial,id,tags,selectedTags=[],schools=[]}:{cities:Options;styles:Options;initial:Fields;id?:string;tags:Options;selectedTags?:string[];schools?:Options}) {
  const t=useTranslations('App'),x=useTranslations('EventsX'),locale=useLocale(),router=useRouter(),s=useFormStatus();
  const [cityId,setCityId]=useState(initial.cityId||'');
  return <form className="editor-form" onSubmit={async e=>{e.preventDefault();s.setBusy(true);s.setError('');
    try{
      const data=new FormData(e.currentTarget);
      const draftKey='event-create:'+locale;
      const operationId=id?undefined:(sessionStorage.getItem(draftKey)||crypto.randomUUID());
      if(operationId)sessionStorage.setItem(draftKey,operationId);
      // The exact marker is not optional: without a venue the organizer must have placed one on the map.
      if(!data.get('pin')&&!data.get('venueId')){s.setBusy(false);s.setError('PLACE_REQUIRED');e.currentTarget.querySelector('.event-place')?.scrollIntoView({block:'center'});return;}
      const body={...values(e.currentTarget),operationId,pin:data.get('pin')?JSON.parse(String(data.get('pin'))):null,tagIds:data.getAll('tagIds'),recurrenceDays:data.getAll('recurrenceDays'),partnerRequired:data.get('partnerRequired')==='on'};
      const result=await submit('/api/events'+(id?'/'+id:''),id?'PATCH':'POST',body);
      if(!id)sessionStorage.removeItem(draftKey);
      // A new event continues in the editor, where the team, the artists and single dates are managed.
      router.push('/'+locale+'/events/'+result.slug+(id?'':'/edit?created=1'));router.refresh();}
    catch(error){s.setError(error instanceof Error?error.message:'GENERIC');}finally{s.setBusy(false);}
  }}>
    {id&&<input type="hidden" name="version" value={initial.version}/>}
    <label>{t('title')}<input name="title" required minLength={3} maxLength={120} defaultValue={initial.title}/></label>
    <label>{t('description')}<textarea name="description" required minLength={10} maxLength={5000} rows={6} defaultValue={initial.description}/></label>
    <div data-guide="event-details"><Select name="styleId" label={t('style')} options={styles} value={initial.styleId}/></div>
    {!id&&schools.length>0&&<label>{x('onBehalfOf')}<select name="schoolProfileId" defaultValue={initial.schoolProfileId||''}><option value="">{x('onBehalfOfMe')}</option>{schools.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><small>{x('onBehalfOfHint')}</small></label>}
    <div data-guide="event-place"><EventPlace cities={cities} cityId={cityId} onCity={setCityId} initial={initial}/></div>
    <MapCardFields initialKey={initial.mapImageKey} initialNote={initial.mapNote}/>
    <label>{x('price')}<input name="priceText" maxLength={120} defaultValue={initial.priceText} placeholder={x('pricePlaceholder')}/><small>{x('priceHint')}</small></label>
    <SwingFields initial={initial} tags={tags} selectedTags={selectedTags}/>
    <div data-guide="event-schedule"><ScheduleFields initial={initial} zone={cities.find(c=>c.id===cityId)?.timezone}/></div>
    <div className="form-grid"><label>{x('attendeeVisibility')}<select name="attendeeVisibility" defaultValue={initial.attendeeVisibility||'PUBLIC'}>{['PUBLIC','ATTENDEES','ORGANIZERS'].map(value=><option key={value} value={value}>{x('visibility_'+value)}</option>)}</select><small>{x('attendeeVisibilityHint')}</small></label>
    <Select name="status" label={t('status')} value={initial.status||'DRAFT'} options={(id?['DRAFT','PUBLISHED','CANCELLED']:['DRAFT','PUBLISHED']).map(id=>({id,name:t(id)}))}/></div>
    {s.feedback}<button data-guide="event-publish" className="button" disabled={s.busy}>{t(s.busy?'working':'saveEvent')}</button>
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
