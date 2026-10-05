'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
export function Bookmark({eventId,initial}:{eventId:string;initial:boolean}){
  const x=useTranslations('EventsX'),t=useTranslations('App'),[saved,setSaved]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  return <div><button className="button secondary" aria-pressed={saved} disabled={busy} onClick={async()=>{setBusy(true);setError(false);try{
    const response=await fetch('/api/events/'+eventId+'/bookmark',{method:saved?'DELETE':'PUT'});if(!response.ok)throw new Error();setSaved(!saved);
  }catch{setError(true);}finally{setBusy(false);}}}>{x(saved?'bookmarked':'bookmark')}</button><small>{x('bookmarkPrivate')}</small>{error&&<p role="alert">{t('error_GENERIC')}</p>}</div>;
}
