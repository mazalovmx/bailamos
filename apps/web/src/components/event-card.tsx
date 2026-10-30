import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {cityLabeler} from '../lib/catalogue/data';
import {mediaUrl} from '../lib/media/url';

export async function EventCard({event,locale,displayDate}:{locale:string;displayDate?:Date;event:{slug:string;title:string;startsAt:Date;timezone:string;status:string;kind:string;format:string;level:string;intensity:string;rrule:string|null;imageKey?:string|null;city:{name:string};styles:{style:{name:string}}[];school?:{name:string;avatarKey:string|null;hiddenAt:Date|null}|null}}) {
  const t=await getTranslations('App'),cityLabel=(await cityLabeler(locale))(event.city.name);
  // The cover photo first; without one the school's logo; without either the drawn placeholder.
  const school=event.school&&!event.school.hiddenAt?event.school:null;
  return <Link className="event-card" href={'/'+locale+'/events/'+event.slug+(displayDate?'?date='+encodeURIComponent(displayDate.toISOString()):'')}>
    {event.imageKey?<div className="event-art event-cover" aria-hidden="true"><img src={mediaUrl(event.imageKey)} alt="" loading="lazy" width={800} height={450}/></div>
      :school?.avatarKey?<div className="event-art event-logo" aria-hidden="true"><img src={mediaUrl(school.avatarKey,320)} alt="" loading="lazy" width={120} height={120}/></div>
      :<div className="event-art" aria-hidden="true"><span>♪</span><i/></div>}
    <div className="event-card-body"><div className="tags">{event.styles.map(({style})=><span key={style.name}>{style.name}</span>)}<span>{t('kind_'+event.kind)}</span>{event.rrule&&<span>{t('weekly')}</span>}{event.status!=='PUBLISHED'&&<span>{t(event.status)}</span>}</div>
    <h3>{event.title}</h3>{school&&<p className="event-card-school">{school.name}</p>}<p>{cityLabel}</p><p>{[event.format!=='UNSPECIFIED'?t('format_'+event.format):'',event.level!=='UNSPECIFIED'?t('level_'+event.level):'',event.intensity!=='UNSPECIFIED'?t('intensity_'+event.intensity):''].filter(Boolean).join(' · ')}</p><time dateTime={(displayDate||event.startsAt).toISOString()}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:event.timezone}).format(displayDate||event.startsAt)}</time></div>
  </Link>;
}
