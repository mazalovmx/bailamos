'use client';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {useT,LocaleSwitch} from './i18n';
type Row={id:string;slug?:string;title?:string|null;name?:string;body?:string;status?:string;hiddenAt?:string|null};
type Options={id:string;name:string}[];
type Props={webUrl:string;global:boolean;schools:Options;schoolId?:string;data:Record<string,Row[]>|null;cities:Options;styles:Options;admins:{email:string;name:string}[]};
export function SchoolsPanel({webUrl,global,schools,schoolId,data,cities,admins}:Props){
  const {t,locale,has}=useT(),router=useRouter(),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  async function send(url:string,body:object,method='POST'){
    setBusy(true);setStatus('');
    try{const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok){const failure=await response.json();throw new Error(failure.error||'SERVER_ERROR');}setStatus(t('school.saved'));router.refresh();}catch(error){const key='error.'+(error instanceof Error?error.message:'SERVER_ERROR');setStatus(has(key)?t(key):t('school.failed'));}finally{setBusy(false);}
  }
  function form(e:FormEvent<HTMLFormElement>,kind:string){e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));const body:Record<string,unknown>={...values,kind};if(kind==='event'){body.startsAt=new Date(String(values.startsAt)).toISOString();body.endsAt=new Date(String(values.endsAt)).toISOString();}if(kind==='venue'){body.lat=Number(values.lat);body.lng=Number(values.lng);}void send('/api/schools/'+schoolId,body);}
  const text=(name:string,key:string,type='text')=><label>{t(key)}<input name={name} type={type} required maxLength={type==='text'?200:undefined}/></label>;
  const select=(name:string,key:string,options:Options)=><label>{t(key)}<select name={name} required>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
  const submit=<button className="button" disabled={busy}>{t('school.create')}</button>;
  return <main style={{maxWidth:1100,margin:'auto',padding:24}}><header data-guide="school-admin-intro"><h1>{t('school.title')}</h1><LocaleSwitch/></header>
    <p>{t('school.scope')}</p><nav>{global&&<a href="/">{t('nav.dashboard')}</a>}<a href={webUrl+'/en/settings'}>{t('school.web')}</a><button className="button ghost" onClick={async()=>{await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});window.location.assign('/login');}}>{t('signOut')}</button></nav>
    <p role="status">{status}</p>
    {global&&<details><summary>{t('school.new')}</summary><form onSubmit={e=>{e.preventDefault();void send('/api/schools',Object.fromEntries(new FormData(e.currentTarget)));}}>{text('name','field.name')}{text('handle','field.handle')}{submit}</form></details>}
    <label data-guide="school-admin-select">{t('school.choose')}<select value={schoolId||''} onChange={e=>window.location.assign('/schools?school='+encodeURIComponent(e.target.value))}>{!schools.length&&<option value="">{t('school.empty')}</option>}{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {schoolId&&<>
      {global&&<section><h2 data-guide="school-admin-admins">{t('school.admins')}</h2><ul>{admins.map(a=><li key={a.email}>{a.name} · {a.email} <button disabled={busy} onClick={()=>void send('/api/schools/'+schoolId+'/admins',{email:a.email,revoke:true})}>{t('school.revoke')}</button></li>)}</ul><form onSubmit={e=>{e.preventDefault();void send('/api/schools/'+schoolId+'/admins',Object.fromEntries(new FormData(e.currentTarget)));}}>{text('email','field.email','email')}<button className="button" disabled={busy}>{t('school.grant')}</button></form></section>}
      <section><h2 data-guide="school-admin-resources">{t('school.resources')}</h2>
        <a className="button" href={webUrl+'/'+locale+'/events/new?school='+encodeURIComponent(schoolId)}>{t('school.newEvent')}</a>
        <details><summary>{t('school.newPost')}</summary><form onSubmit={e=>form(e,'post')}>{text('title','field.title')}<label>{t('field.body')}<textarea name="body" required maxLength={10000}/></label>{submit}</form></details>
        <details><summary>{t('school.newVenue')}</summary><form onSubmit={e=>form(e,'venue')}>{text('name','field.name')}{text('address','field.address')}{select('cityId','field.cityId',cities)}<label>{t('field.lat')}<input name="lat" type="number" min="-90" max="90" step="any" required/></label><label>{t('field.lng')}<input name="lng" type="number" min="-180" max="180" step="any" required/></label>{submit}</form></details>
        <details><summary>{t('school.newChat')}</summary><form onSubmit={e=>form(e,'conversation')}>{text('title','field.title')}{submit}</form></details>
      </section>
      {Object.entries(data||{}).map(([group,rows])=><section key={group}><h2>{t('resource.'+group)}</h2>{!rows.length&&<p>{t('school.noResources')}</p>}<ul className="school-records">{rows.map(row=>{const kind=group==='conversations'?'conversation':group.slice(0,-1);const actions=group==='events'?['publish','cancel']:group==='posts'?['publish','hide','restore']:group==='conversations'?[]:['hide','restore'];return <li key={row.id}><strong>{row.title||row.name||row.body||row.id}</strong>{group==='events'&&row.slug&&<a href={webUrl+'/'+locale+'/events/'+row.slug+'/edit'}>{t('school.editEvent')}</a>}<small> {row.status} {row.hiddenAt?t('school.hidden'):''}</small><div>{actions.map(action=><button key={action} disabled={busy} onClick={()=>void send('/api/schools/'+schoolId,{id:row.id,kind,action},'PATCH')}>{t('school.'+action)}</button>)}</div>{group!=='messages'&&<details><summary>{t('school.rename')}</summary><form onSubmit={e=>{e.preventDefault();void send('/api/schools/'+schoolId,{id:row.id,kind,action:'rename',title:new FormData(e.currentTarget).get('title')},'PATCH');}}><input name="title" aria-label={t('field.title')} defaultValue={row.title||row.name||''} required minLength={2} maxLength={200}/><button disabled={busy}>{t('school.save')}</button></form></details>}{group==='conversations'&&<form onSubmit={e=>{e.preventDefault();const fields=Object.fromEntries(new FormData(e.currentTarget));void send('/api/schools/'+schoolId,{id:row.id,kind,...fields},'PATCH');}}>{text('profileId','school.memberId')}<select name="action" aria-label={t('school.members')}><option value="addMember">{t('school.addMember')}</option><option value="removeMember">{t('school.removeMember')}</option></select><button disabled={busy}>{t('school.save')}</button></form>}</li>;})}</ul></section>)}
    </>}
  </main>;
}
