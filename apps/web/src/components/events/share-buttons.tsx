'use client';
import {useEffect,useState} from 'react';
import {useTranslations} from 'next-intl';
// Copy the (short) link, or hand it to the device's share sheet where the Web Share API exists.
export function ShareButtons({url,title,text}:{url:string;title:string;text:string}) {
  const x=useTranslations('EventsX');
  const [message,setMessage]=useState(''),[canShare,setCanShare]=useState(false);
  useEffect(()=>{setCanShare(typeof navigator!=='undefined'&&typeof navigator.share==='function');},[]);
  async function copy() {
    try{await navigator.clipboard.writeText(url);setMessage(x('linkCopied'));}
    catch{setMessage(x('copyFailed'));}
  }
  async function share() {
    try{await navigator.share({title,text,url});}
    catch(error){if(!(error instanceof Error&&error.name==='AbortError')) await copy();}
  }
  return <div className="share-link">
    <label>{x('shortLink')}<input readOnly value={url} onFocus={e=>e.currentTarget.select()}/></label>
    <div className="panel-actions"><button type="button" className="button secondary" onClick={copy}>{x('copyLink')}</button>
    {canShare&&<button type="button" className="button secondary" onClick={share}>{x('share')}</button>}</div>
    <p role="status" aria-live="polite" className="action-status">{message}</p>
  </div>;
}
