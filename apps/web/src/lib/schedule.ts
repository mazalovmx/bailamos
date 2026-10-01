import {RRule} from 'rrule';
import {DateTime} from 'luxon';
import {eventTimes} from './validation';
export function schedule(start:string,end:string,zone:string,weeks:number) {
  if(!Number.isInteger(weeks)||weeks<1||weeks>52) throw new Error('INVALID_TIME');
  const initial=eventTimes(start,end,zone);
  const floatingStart=DateTime.fromISO(start,{zone:'UTC'});
  const floatingEnd=DateTime.fromISO(end,{zone:'UTC'});
  const duration=floatingEnd.diff(floatingStart).as('milliseconds');
  const rule=new RRule({freq:RRule.WEEKLY,dtstart:floatingStart.toJSDate(),count:weeks});
  const occurrences=rule.all().map(date=>{
    const from=DateTime.fromJSDate(date,{zone:'UTC'});
    const to=from.plus({milliseconds:duration});
    return eventTimes(from.toFormat("yyyy-MM-dd'T'HH:mm"),to.toFormat("yyyy-MM-dd'T'HH:mm"),zone);
  });
  return {...initial,rrule:weeks>1?'FREQ=WEEKLY;COUNT='+weeks:null,occurrences};
}
