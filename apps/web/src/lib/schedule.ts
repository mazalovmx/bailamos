import {RRule} from 'rrule';
import {DateTime} from 'luxon';
import {eventTimes} from './validation';
// Pure and shared: the event form calls it for the live preview, the API for materialization.
export const weekdays=['MO','TU','WE','TH','FR','SA','SU'] as const;
export type Weekday=typeof weekdays[number];
// count = number of dates in the series (1 = single event); until = last local calendar day (yyyy-MM-dd), an alternative to count.
export type Recurrence={count?:number;interval?:number;byDay?:readonly string[];until?:string|null};
export const MAX_DATES=520,MAX_INTERVAL=4;
const stamp="yyyy-MM-dd'T'HH:mm";
export function schedule(start:string,end:string,zone:string,recurrence:number|Recurrence=1) {
  const input:Recurrence=typeof recurrence==='number'?{count:recurrence}:recurrence;
  const count=input.count??1,interval=input.interval??1,until=input.until||null;
  if(!Number.isInteger(count)||count<1||count>MAX_DATES||!Number.isInteger(interval)||interval<1||interval>MAX_INTERVAL) throw new Error('INVALID_TIME');
  const initial=eventTimes(start,end,zone);
  // Wall-clock times are expanded as "floating" UTC values and only then placed in the zone, so the local hour survives DST changes.
  const floatingStart=DateTime.fromISO(start,{zone:'UTC'}),floatingEnd=DateTime.fromISO(end,{zone:'UTC'});
  const duration=floatingEnd.diff(floatingStart).as('milliseconds');
  if(count===1&&!until) return {...initial,rrule:null,occurrences:[initial]};
  const startDay=weekdays[floatingStart.weekday-1];
  const picked=new Set<string>([startDay,...(input.byDay||[])]);
  if([...picked].some(day=>!weekdays.includes(day as Weekday))) throw new Error('INVALID_TIME');
  // The first date is always part of the series, so its weekday is added to the selection.
  const days=weekdays.filter(day=>picked.has(day));
  let floatingUntil:DateTime|null=null;
  if(until){
    floatingUntil=DateTime.fromISO(until+'T23:59:59',{zone:'UTC'});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(until)||!floatingUntil.isValid) throw new Error('INVALID_TIME');
  }
  const rule=new RRule({freq:RRule.WEEKLY,dtstart:floatingStart.toJSDate(),interval,wkst:RRule.MO,
    byweekday:days.map(day=>weekdays.indexOf(day)),
    ...(floatingUntil?{until:floatingUntil.toJSDate()}:{count})});
  // One more than the limit is enough to know that an "until" series is too long.
  const dates=rule.all((_,index)=>index<=MAX_DATES);
  if(dates.length>MAX_DATES) throw new Error('TOO_MANY_DATES');
  if(dates.length<2) throw new Error('INVALID_TIME');
  const occurrences=dates.map(date=>{
    const from=DateTime.fromJSDate(date,{zone:'UTC'}),to=from.plus({milliseconds:duration});
    return eventTimes(from.toFormat(stamp),to.toFormat(stamp),zone);
  });
  // UNTIL is stored in UTC (RFC 5545) as the end of that local day in the event's zone.
  const untilUtc=until?DateTime.fromISO(until+'T23:59:59',{zone}).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'"):'';
  const text='FREQ=WEEKLY'+(interval>1?';INTERVAL='+interval:'')+(days.length>1?';BYDAY='+days.join(','):'')+(until?';UNTIL='+untilUtc:';COUNT='+count);
  return {...initial,rrule:text,occurrences};
}
// Reads a stored rule back into form fields. Unknown or absent rules become a single event.
export function parseRecurrence(rrule:string|null|undefined,zone:string):Required<Omit<Recurrence,'byDay'>>&{byDay:Weekday[]} {
  const parts=Object.fromEntries((rrule||'').split(';').map(part=>part.split('=') as [string,string]));
  const untilUtc=parts.UNTIL?DateTime.fromFormat(parts.UNTIL,"yyyyMMdd'T'HHmmss'Z'",{zone:'UTC'}):null;
  return {count:parts.UNTIL?1:Math.min(Math.max(Number(parts.COUNT)||1,1),MAX_DATES),interval:Math.min(Math.max(Number(parts.INTERVAL)||1,1),MAX_INTERVAL),
    byDay:weekdays.filter(day=>(parts.BYDAY||'').split(',').includes(day)),
    until:untilUtc?.isValid?untilUtc.setZone(zone).toFormat('yyyy-MM-dd'):null};
}
// Start instants of the first dates of a series, for the "next ten dates" preview.
export function previewDates(start:string,end:string,zone:string,recurrence:number|Recurrence,limit=10) {
  return schedule(start,end,zone,recurrence).occurrences.slice(0,limit).map(o=>o.startsAt);
}
// One date on its own (a single date of a series that is moved): wall-clock times in the event's zone.
// A local time that DST skips or repeats is refused, exactly as for a whole series.
export function singleDate(start:string,end:string,zone:string) {return eventTimes(start,end,zone);}
// The wall-clock reading of an instant in a zone, in the format of <input type="datetime-local">.
export const localStamp=(date:Date,zone:string)=>DateTime.fromJSDate(date,{zone}).toFormat(stamp);
