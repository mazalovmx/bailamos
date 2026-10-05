'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
export function SchoolForm({cities,schoolId}:{cities?:{id:string;name:string}[];schoolId?:string}){
  const t=useTranslations('App'),x=useTranslations('EventsX'),router=useRouter();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  return <form className="editor-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');const data=Object.fromEntries(new FormData(e.currentTarget));try{
    const response=await fetch('/api/schools'+(schoolId?'/'+schoolId+'/admins':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,revoke:data.revoke==='on'})});
    const result=await response.json();if(!response.ok)throw new Error(result.error);setMessage(x('saved'));router.refresh();
  }catch(error){const code=error instanceof Error?error.message:'GENERIC';setMessage(t.has('error_'+code)?t('error_'+code):t('error_GENERIC'));}finally{setBusy(false);}}}>
    {schoolId?<><label>{t('email')}<input name="email" type="email" required/></label><label className="checkbox"><input type="checkbox" name="revoke"/>{x('revokeAdmin')}</label></>:<>
      <label>{t('name')}<input name="name" required minLength={2} maxLength={80}/></label><label>{t('handle')}<input name="handle" required pattern="[a-z0-9][a-z0-9_-]{2,29}"/></label>
      <label>{t('city')}<select name="cityId" required>{cities?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
    <p role="status">{message}</p><button className="button" disabled={busy}>{busy?t('working'):x(schoolId?'save':'create')}</button>
  </form>;
}
