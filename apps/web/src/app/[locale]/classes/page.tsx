import Link from 'next/link';
import {db} from '@dance/db';
import {DateTime} from 'luxon';
import {discoveryQuery} from '../../../lib/discovery';
import {eventSearchAll} from '../../../lib/event-search';
import {DiscoveryNav} from '../../../components/discovery-nav';
import {queryParams,values} from '../../../lib/search-query';
import {MultiFilter} from '../../../components/multi-filter';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {cityName} from '../../../lib/catalogue/city-name';
import {allCities, allStyles} from '../../../lib/catalogue/data';
import {currentCitySlug} from '../../../lib/catalogue/current-city';
import {classLevels} from '../../../lib/swing';
import {siteUrl} from '../../../lib/mail';
import {DAY_PARTS, parseDayPart, parseLevels, parseWeekdays, weekOf, weekTimetable} from '../../../lib/courses/timetable';
import {WeekTimetable} from '../../../components/courses/timetable';
import {WeekNav} from '../../../components/courses/week-nav';
import '../../styles/courses.css';
type Props = {params: Promise<{locale: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {locale} = await params, t = await getTranslations({locale, namespace: 'Courses'}), origin = siteUrl();
  return {title: t('classesTitle'), description: t('classesIntro'), alternates: {canonical: origin + '/' + locale + '/classes',
    languages: {en: origin + '/en/classes', es: origin + '/es/classes', ru: origin + '/ru/classes'}}};
}
export default async function Classes({params, searchParams}: Props) {
  const {locale} = await params, raw = await searchParams;
  const value = (key: string) => {const item = raw[key]; return (Array.isArray(item) ? item[0] : item || '').slice(0, 80).trim();};
  const [t, app, cities, styles, cookieCity] = await Promise.all([getTranslations('Courses'), getTranslations('App'), allCities(), allStyles(), currentCitySlug()]);
  // No ?city= means the visitor's chosen city; "all" asks for every city explicitly.
  const cityValues=values(raw.city).filter(c=>c!=='all');
  const citySlug = cityValues[0] || (raw.city===undefined?cookieCity:null) || 'all', city = citySlug === 'all'||cityValues.length>1 ? null : cities.find(item => item.slug === citySlug || item.id === citySlug) || null;
  const style = styles.find(item => item.slug === value('style') || item.id === value('style')) || null;
  const level = parseLevels(value('level'))[0] || '', weekday = parseWeekdays(value('weekday'))[0] || 0, dayPart = parseDayPart(value('time'));
  const {query:discovery}=await discoveryQuery(raw);
  const zone = city?.timezone || 'UTC', week = weekOf(value('week')||value('from'), zone), current = weekOf(null, zone);
  const timetable = await weekTimetable(week, {query:discovery,weekdays: weekday ? [weekday] : [], dayPart});
  const query = {...discovery,weekday:weekday?String(weekday):'',time:dayPart||''};
  const weekdayName = new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: 'UTC'}), path = '/' + locale + '/classes';
  const filtered = !!(style || level || weekday || dayPart), schoolsHref = '/' + locale + '/schools' + (city ? '?city=' + encodeURIComponent(city.slug) : '');
  const firstClass=timetable.total?null:await db.eventOccurrence.findFirst({where:{cancelled:false,startsAt:{gte:new Date()},event:{AND:[await eventSearchAll(discovery)],rrule:{not:null},kind:{in:['CLASS','PRACTICE']}}},orderBy:{startsAt:'asc'},select:{startsAt:true,event:{select:{timezone:true}}}});
  const firstWeek=firstClass?weekOf(DateTime.fromJSDate(firstClass.startsAt,{zone:firstClass.event.timezone}).toISODate(),zone).start:null;
  return <main className="courses-page">
    <p className="eyebrow">{t('eyebrow')}</p><h1>{city ? t('classesIn', {city: cityName(city, locale)}) : t('classesTitle')}</h1>
    <p className="intro">{t('classesIntro')}</p>
    <DiscoveryNav locale={locale} query={discovery}/>
    <form className="courses-filters" action={path} role="search" aria-label={t('filters')}>
      <input type="hidden" name="city" value="all"/>
      <MultiFilter name="city" label={t('city')} all={t('allCities')} items={cities} initial={values(discovery.city).filter(c=>c!=='all')}/>
      <MultiFilter name="style" label={t('style')} all={t('allStyles')} items={styles} initial={values(discovery.style)}/>
      <MultiFilter name="level" label={t('level')} all={t('allLevels')} items={classLevels.filter(item=>item!=='UNSPECIFIED').map(id=>({id,name:app('level_'+id)}))} initial={values(discovery.level)}/>
      {[...queryParams(discovery)].filter(([key])=>!['city','style','level','week','weekday','time'].includes(key)).map(([key,value],i)=><input key={i} type="hidden" name={key} value={value}/>)}
      <label>{t('weekday')}<select name="weekday" defaultValue={weekday ? String(weekday) : ''}><option value="">{t('allWeekdays')}</option>
        {week.dates.map((date, index) => <option key={date} value={index + 1}>{weekdayName.format(new Date(date + 'T12:00:00Z'))}</option>)}</select></label>
      <label>{t('timeOfDay')}<select name="time" defaultValue={dayPart || ''}><option value="">{t('anyTime')}</option>
        {DAY_PARTS.map(part => <option key={part} value={part}>{t('time_' + part)}</option>)}</select></label>
      {value('week') && <input type="hidden" name="week" value={week.start}/>}
      <div className="courses-filter-actions"><button className="button">{t('apply')}</button>
        {filtered && <Link href={path + '?city=' + encodeURIComponent(city ? city.slug : 'all')}>{t('clearFilters')}</Link>}</div>
    </form>
    <WeekNav week={week} current={current} path={path} query={query} locale={locale}/>
    <p className="courses-meta" role="status">{t('classesCount', {count: timetable.total})}{' · '}
      {city ? t('timesLocalCity', {city: cityName(city, locale), zone: city.timezone}) : t('timesLocal')}</p>
    {timetable.truncated && <p className="notice">{t('truncated')}</p>}
    {timetable.total ? <WeekTimetable timetable={timetable} locale={locale} showCity={!city}/> :
      <p className="notice" role="status">{filtered ? t('noClassesFiltered') : t('noClasses')}</p>}
    {!timetable.total&&firstWeek&&firstWeek!==week.start&&<p><Link href={path+'?'+queryParams({...discovery,week:firstWeek})}>{t('classesStart',{date:new Intl.DateTimeFormat(locale,{dateStyle:'long',timeZone:'UTC'}).format(new Date(firstWeek+'T00:00:00Z'))})}</Link></p>}
    <p className="courses-links"><Link href={schoolsHref}>{t('browseSchools')}</Link><Link href={'/' + locale + '/events/new'}>{t('addClass')}</Link></p>
  </main>;
}
