'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {api,useAction} from './client';
type Answer='GOING'|'INTERESTED'|'DECLINED';
// The answer for one date of a series, next to the answer for the whole series. It shows which answer counts
// for the selected date and where it comes from, and lets the visitor answer for this date only.
// `date` is the already formatted date; `series` and `override` are the stored answers ('' for none).
export function DateRsvp({eventId,occurrenceId,date,series,override:initial}:{eventId:string;occurrenceId:string;date:string;series:string;override:string}) {
  const x=useTranslations('EventsX'),t=useTranslations('App'),router=useRouter(),a=useAction();
  const [override,setOverride]=useState(initial);
  const effective=override||(series==='DECLINED'?'':series);
  const url='/api/events/'+eventId+'/occurrences/'+occurrenceId+'/rsvp';
  const choose=(value:Answer|'')=>a.run(async()=>{
    await (value?api(url,'PUT',{status:value}):api(url,'DELETE'));
    setOverride(value);router.refresh();
  },x(value?'dateAnswerSaved':'dateAnswerCleared'));
  const choices:[Answer,string][]=[['GOING',t('going')],['INTERESTED',t('interested')],['DECLINED',x('notThisDate')]];
  return <div className="date-rsvp" role="group" aria-labelledby="date-rsvp-title">
    <h3 id="date-rsvp-title">{x('rsvpThisDate',{date})}</h3>
    <p className="field-note">{x('answer_'+(effective||'NONE'))} {effective&&x(override?'answerFromDate':'answerFromSeries')}</p>
    <div className="rsvp-buttons">
      {choices.map(([value,label])=><button key={value} type="button" className={override===value?'button':'button secondary'} aria-pressed={override===value} disabled={a.busy} onClick={()=>choose(value)}>{label}</button>)}
      {override&&<button type="button" className="button secondary" disabled={a.busy} onClick={()=>choose('')}>{x('sameAsSeries')}</button>}
    </div>
    <p className="field-note">{x('rsvpThisDateHint')}</p>
    {a.feedback}
  </div>;
}
