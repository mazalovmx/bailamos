'use client';
import {useMemo,useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {DateTime} from 'luxon';
import {schedule,weekdays,MAX_DATES,MAX_INTERVAL} from '../../lib/schedule';
import '../../app/styles/events.css';
type Initial=Record<string,string>;
// Start, end and repetition of an event with a live preview of its first dates. The preview is computed by
// the very function the server uses to create the dates, in the time zone of the chosen city.
export function ScheduleFields({initial,zone}:{initial:Initial;zone?:string}) {
  const t=useTranslations('App'),x=useTranslations('EventsX'),locale=useLocale();
  const [start,setStart]=useState(initial.startsLocal||''),[end,setEnd]=useState(initial.endsLocal||'');
  const [weekly,setWeekly]=useState(Number(initial.recurrenceWeeks)>1||!!initial.recurrenceUntil);
  const [count,setCount]=useState(Number(initial.recurrenceWeeks)>1?initial.recurrenceWeeks:'8');
  const [interval,setIntervalValue]=useState(initial.recurrenceInterval||'1');
  const [days,setDays]=useState<string[]>((initial.recurrenceDays||'').split(',').filter(Boolean));
  const [endMode,setEndMode]=useState(initial.recurrenceUntil?'UNTIL':'COUNT'),[until,setUntil]=useState(initial.recurrenceUntil||'');
  const startDay=DateTime.fromISO(start).isValid?weekdays[DateTime.fromISO(start).weekday-1]:null;
  const dayName=useMemo(()=>{
    // 1 January 2024 is a Monday: enough to name the weekdays in the interface language.
    const format=new Intl.DateTimeFormat(locale,{weekday:'long',timeZone:'UTC'});
    return (index:number)=>format.format(new Date(Date.UTC(2024,0,1+index)));
  },[locale]);
  const preview=useMemo(()=>{
    if(!zone||!start||!end) return null;
    try{
      const {occurrences}=schedule(start,end,zone,weekly?{count:endMode==='COUNT'?Number(count):1,interval:Number(interval),byDay:days,until:endMode==='UNTIL'?until:null}:1);
      return {dates:occurrences.slice(0,10).map(o=>o.startsAt),total:occurrences.length,error:''};
    }catch(error){
      return {dates:[],total:0,error:error instanceof Error&&error.message==='TOO_MANY_DATES'?'TOO_MANY_DATES':'INVALID_TIME'};
    }
  },[zone,start,end,weekly,count,interval,days,endMode,until]);
  const label=useMemo(()=>zone?new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:zone}):null,[locale,zone]);
  return <fieldset className="schedule-fields"><legend>{t('schedule')}</legend>
    <p className="field-note">{t('timezoneNote')} <strong>{zone}</strong></p>
    <div className="form-grid"><label>{t('starts')}<input name="startsLocal" type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>{t('ends')}<input name="endsLocal" type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
    <div className="form-grid"><label>{x('repeat')}<select value={weekly?'WEEKLY':'ONCE'} onChange={e=>setWeekly(e.target.value==='WEEKLY')}><option value="ONCE">{t('ONCE')}</option><option value="WEEKLY">{x('repeatWeekly')}</option></select></label>
    {weekly&&<label>{x('repeatEvery')}<select name="recurrenceInterval" value={interval} onChange={e=>setIntervalValue(e.target.value)}>{Array.from({length:MAX_INTERVAL},(_,i)=><option key={i+1} value={i+1}>{x('everyWeeks',{count:i+1})}</option>)}</select></label>}</div>
    {weekly?<>
      <fieldset className="weekday-picker"><legend>{x('repeatDays')}</legend>{weekdays.map((day,index)=>
        <label className="checkbox" key={day}><input type="checkbox" name="recurrenceDays" value={day} checked={day===startDay||days.includes(day)} disabled={day===startDay}
          onChange={e=>setDays(current=>e.target.checked?[...current,day]:current.filter(value=>value!==day))}/>{dayName(index)}</label>)}
        <p className="field-note">{x('repeatDaysHint')}</p></fieldset>
      <div className="form-grid"><label>{x('repeatEnds')}<select value={endMode} onChange={e=>setEndMode(e.target.value)}><option value="COUNT">{x('endsAfterCount')}</option><option value="UNTIL">{x('endsOnDate')}</option></select></label>
      {endMode==='COUNT'?<label>{x('repeatCount')}<input name="recurrenceWeeks" type="number" min={2} max={MAX_DATES} required value={count} onChange={e=>setCount(e.target.value)}/></label>
        :<label>{x('repeatUntil')}<input name="recurrenceUntil" type="date" required min={start.slice(0,10)} value={until} onChange={e=>setUntil(e.target.value)}/></label>}</div>
      {endMode==='UNTIL'&&<input type="hidden" name="recurrenceWeeks" value="1"/>}
      <p className="field-note">{x('repeatLimit',{max:MAX_DATES})}</p>
    </>:<input type="hidden" name="recurrenceWeeks" value="1"/>}
    <div className="date-preview" role="status" aria-live="polite">{preview&&(preview.error
      ?<p className="form-error">{preview.error==='TOO_MANY_DATES'?x('error_TOO_MANY_DATES'):t('error_INVALID_TIME')}</p>
      :<><h3>{x('previewTitle',{count:preview.total})}</h3><p className="field-note">{x('previewZone',{zone:zone||''})}</p>
        <ol>{preview.dates.map(date=><li key={date.toISOString()}><time dateTime={date.toISOString()}>{label?.format(date)}</time></li>)}</ol>
        {preview.total>preview.dates.length&&<p className="field-note">{x('previewMore',{count:preview.total-preview.dates.length})}</p>}</>)}</div>
  </fieldset>;
}
