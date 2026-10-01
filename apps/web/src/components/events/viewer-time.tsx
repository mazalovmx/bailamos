'use client';
import {useEffect,useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {sameWallClock,zonedLabel} from '../../lib/events/time';
// The event's time on the visitor's own clock. Rendered only in the browser, and only when that clock
// shows something different from the event's zone — someone in the same city sees nothing extra.
export function ViewerTime({startsAt,endsAt,eventZone}:{startsAt:string;endsAt?:string|null;eventZone:string}) {
  const x=useTranslations('EventsX'),locale=useLocale();
  const [zone,setZone]=useState<string|null>(null);
  useEffect(()=>{try{setZone(Intl.DateTimeFormat().resolvedOptions().timeZone||null);}catch{setZone(null);}},[]);
  if(!zone||sameWallClock(new Date(startsAt),eventZone,zone)) return null;
  return <p className="viewer-time"><strong>{x('yourTime')}</strong> <time dateTime={startsAt}>{zonedLabel(new Date(startsAt),locale,zone)}</time>
    {endsAt&&<> — <time dateTime={endsAt}>{zonedLabel(new Date(endsAt),locale,zone)}</time></>} <small>{zone}</small></p>;
}
