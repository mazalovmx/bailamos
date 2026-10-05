'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
export function ExtendSeries({eventId,version}:{eventId:string;version:number}){
  const x=useTranslations('EventsX'),t=useTranslations('App'),router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  return <details><summary>{x('extendSeries')}</summary><p>{x('extendHint')}</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');try{
    const count=Number(new FormData(e.currentTarget).get('count'));
    const response=await fetch('/api/events/'+eventId+'/extend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count,version})});
    const data=await response.json();if(!response.ok)throw new Error(data.error);setMessage(x('extensionSaved'));router.refresh();
  }catch(error){const key='error_'+(error instanceof Error?error.message:'GENERIC');setMessage(x.has(key)?x(key):t('error_GENERIC'));}finally{setBusy(false);}}}>
    <label>{x('extendCount')}<input type="number" name="count" min={1} max={52} defaultValue={8} required/></label><button className="button" disabled={busy}>{x('extendSeries')}</button><p role="status">{message}</p>
  </form></details>;
}
