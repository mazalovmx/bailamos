import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
export async function EventCard({event,locale,displayDate}:{locale:string;displayDate?:Date;event:{slug:string;title:string;startsAt:Date;timezone:string;status:string;kind:string;format:string;level:string;intensity:string;rrule:string|null;city:{name:string};styles:{style:{name:string}}[]}}) {
  const t=await getTranslations('App');
  return <Link className="event-card" href={'/'+locale+'/events/'+event.slug+(displayDate?'?date='+encodeURIComponent(displayDate.toISOString()):'')}>
    <div className="event-art" aria-hidden="true"><span>♪</span><i/></div>
    <div className="event-card-body"><div className="tags">{event.styles.map(({style})=><span key={style.name}>{style.name}</span>)}<span>{t('kind_'+event.kind)}</span>{event.rrule&&<span>{t('weekly')}</span>}{event.status!=='PUBLISHED'&&<span>{t(event.status)}</span>}</div>
    <h3>{event.title}</h3><p>{event.city.name}</p><p>{[event.format!=='UNSPECIFIED'?t('format_'+event.format):'',event.level!=='UNSPECIFIED'?t('level_'+event.level):'',event.intensity!=='UNSPECIFIED'?t('intensity_'+event.intensity):''].filter(Boolean).join(' · ')}</p><time dateTime={(displayDate||event.startsAt).toISOString()}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:event.timezone}).format(displayDate||event.startsAt)}</time></div>
  </Link>;
}
