'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
// Same-origin JSON call; the server answers {error:'CODE'} on failure, which becomes the thrown message.
export async function api(url:string,method:string,body?:unknown) {
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||data.code||'GENERIC');
  return data;
}
// Error codes are translated as error_<CODE>: first in the events namespace, then in the shared application one.
export function useErrorText() {
  const x=useTranslations('EventsX'),t=useTranslations('App');
  return (code:string)=>x.has('error_'+code)?x('error_'+code):t.has('error_'+code)?t('error_'+code):t('error_GENERIC');
}
export function useAction() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const text=useErrorText();
  // Runs one request at a time and keeps its outcome for the live regions below.
  async function run(task:()=>Promise<unknown>,success='') {
    setBusy(true);setError('');setDone('');
    try{await task();setDone(success);return true;}
    catch(problem){setError(problem instanceof Error?problem.message:'GENERIC');return false;}
    finally{setBusy(false);}
  }
  return {busy,run,
    feedback:<>{error&&<p role="alert" className="form-error">{text(error)}</p>}<p role="status" aria-live="polite" className="action-status">{done}</p></>};
}
