import Link from 'next/link';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {cityName} from '../../../lib/catalogue/city-name';
import {allCities, allStyles} from '../../../lib/catalogue/data';
import {currentCitySlug} from '../../../lib/catalogue/current-city';
import {classLevels} from '../../../lib/swing';
import {siteUrl} from '../../../lib/mail';
import {DAY_PARTS, parseDayPart, parseLevels, parseWeekdays, styleFilter, weekOf, weekTimetable} from '../../../lib/courses/timetable';
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
  const citySlug = value('city') || cookieCity || 'all', city = citySlug === 'all' ? null : cities.find(item => item.slug === citySlug || item.id === citySlug) || null;
  const style = styles.find(item => item.slug === value('style') || item.id === value('style')) || null;
  const level = parseLevels(value('level'))[0] || '', weekday = parseWeekdays(value('weekday'))[0] || 0, dayPart = parseDayPart(value('time'));
  const zone = city?.timezone || 'UTC', week = weekOf(value('week'), zone), current = weekOf(null, zone);
  const timetable = await weekTimetable(week, {cityId: city?.id, styleIds: styleFilter(styles, value('style')) ?? (value('style') ? [] : undefined),
    levels: level ? [level] : [], weekdays: weekday ? [weekday] : [], dayPart});
  const query = Object.fromEntries(Object.entries({city: city ? city.slug : 'all', style: style?.slug || '', level, weekday: weekday ? String(weekday) : '', time: dayPart || ''}).filter(([, item]) => item));
  const weekdayName = new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: 'UTC'}), path = '/' + locale + '/classes';
  const filtered = !!(style || level || weekday || dayPart), schoolsHref = '/' + locale + '/schools' + (city ? '?city=' + encodeURIComponent(city.slug) : '');
  return <main className="courses-page">
    <p className="eyebrow">{t('eyebrow')}</p><h1>{city ? t('classesIn', {city: cityName(city, locale)}) : t('classesTitle')}</h1>
    <p className="intro">{t('classesIntro')}</p>
    <form className="courses-filters" action={path} role="search" aria-label={t('filters')}>
      <label>{t('city')}<select name="city" defaultValue={city ? city.slug : 'all'}><option value="all">{t('allCities')}</option>
        {cities.map(item => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
      <label>{t('style')}<select name="style" defaultValue={style?.slug || ''}><option value="">{t('allStyles')}</option>
        {styles.map(item => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
      <label>{t('level')}<select name="level" defaultValue={level}><option value="">{t('allLevels')}</option>
        {classLevels.filter(item => item !== 'UNSPECIFIED').map(item => <option key={item} value={item}>{app('level_' + item)}</option>)}</select></label>
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
    <p className="courses-links"><Link href={schoolsHref}>{t('browseSchools')}</Link><Link href={'/' + locale + '/events/new'}>{t('addClass')}</Link></p>
  </main>;
}
