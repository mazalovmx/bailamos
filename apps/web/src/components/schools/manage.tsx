'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
export function SchoolForm({cities,schoolId,adminUrl}:{cities?:{id:string;name:string}[];schoolId?:string;adminUrl?:string}){
  const t=useTranslations('App'),x=useTranslations('EventsX'),router=useRouter();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [invited,setInvited]=useState('');
  return <form className="editor-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');const data=Object.fromEntries(new FormData(e.currentTarget));try{
    const response=await fetch('/api/schools'+(schoolId?'/'+schoolId+'/admins':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(schoolId?{...data,revoke:data.revoke==='on'}:data)});
    const result=await response.json();if(!response.ok)throw new Error(result.error);setInvited(schoolId&&data.revoke!=='on'?result.email:'');setMessage(x('saved'));router.refresh();
  }catch(error){const code=error instanceof Error?error.message:'GENERIC';setMessage(t.has('error_'+code)?t('error_'+code):t('error_GENERIC'));}finally{setBusy(false);}}}>
    {schoolId?<><p>{x('schoolTeamHelp')}</p><label>{t('email')}<input name="email" type="email" required maxLength={254}/></label><label>{x('schoolAccessRole')}<select name="role"><option value="ADMIN">{x('schoolRoleAdmin')}</option><option value="MANAGER">{x('schoolRoleManager')}</option></select></label><label className="checkbox"><input type="checkbox" name="revoke"/>{x('revokeAdmin')}</label></>:<>
      <label>{t('name')}<input name="name" required minLength={2} maxLength={80}/></label><label>{t('handle')}<input name="handle" required pattern="[a-z0-9][a-z0-9_-]{2,29}"/></label>
      <label>{t('city')}<select name="cityId" required>{cities?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
    <p role="status">{message}</p><button className="button" disabled={busy}>{busy?t('working'):x(schoolId?'save':'create')}</button>
    {invited&&adminUrl&&<p role="status">{x('schoolInviteSaved',{email:invited})} <a href={adminUrl+'/login'}>{adminUrl+'/login'}</a></p>}
  </form>;
}
