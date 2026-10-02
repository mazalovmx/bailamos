import Link from 'next/link';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {cityName} from '../../../lib/catalogue/city-name';
import {cityLabeler} from '../../../lib/catalogue/data';

import {allCities} from '../../../lib/catalogue/data';
import {currentCitySlug} from '../../../lib/catalogue/current-city';
import {siteUrl} from '../../../lib/mail';
import {mediaUrl} from '../../../lib/account/media';
import {listSchools} from '../../../lib/courses/schools';
import {currentUser} from '../../../lib/session';
import {SectionGuide} from '../../../components/guide/section-guide';
import '../../styles/courses.css';
type Props = {params: Promise<{locale: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {locale} = await params, t = await getTranslations({locale, namespace: 'Courses'}), origin = siteUrl();
  return {title: t('schoolsTitle'), description: t('schoolsIntro'), alternates: {canonical: origin + '/' + locale + '/schools',
    languages: {en: origin + '/en/schools', es: origin + '/es/schools', ru: origin + '/ru/schools'}}};
}
export default async function Schools({params, searchParams}: Props) {
  const {locale} = await params, raw = (await searchParams).city, requested = (Array.isArray(raw) ? raw[0] : raw || '').slice(0, 80).trim();
  const [t, cities, cookieCity, user, guide] = await Promise.all([getTranslations('Courses'), allCities(), currentCitySlug(), currentUser(), getTranslations('Guide')]);
  const label = await cityLabeler(locale);
  // No ?city= means the visitor's chosen city; "all" asks for every city explicitly.
  const slug = requested || cookieCity || 'all', city = slug === 'all' ? null : cities.find(item => item.slug === slug || item.id === slug) || null;
  const {schools, truncated} = await listSchools(city?.id), path = '/' + locale + '/schools';
  return <main className="courses-page"><SectionGuide id="schools" userId={user?.id} steps={['create','list']}/>
    <p className="eyebrow">{t('eyebrow')}</p><h1>{city ? t('schoolsIn', {city: cityName(city, locale)}) : t('schoolsTitle')}</h1>
    <p className="intro">{t('schoolsIntro')}</p>
    <div className="home-capabilities"><section data-guide="schools-create"><h2>{guide('schools.createTitle')}</h2><p>{guide('schools.createText')}</p><Link href={'/'+locale+(user?(user.profile?'/profile':'/onboarding'):'/login')}>{guide('schools.createAction')} →</Link></section></div>
    <form className="courses-filters courses-filters-short" action={path} role="search" aria-label={t('filters')}>
      <label>{t('city')}<select name="city" defaultValue={city ? city.slug : 'all'}><option value="all">{t('allCities')}</option>
        {cities.map(item => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
      <div className="courses-filter-actions"><button className="button">{t('apply')}</button></div>
    </form>
    <p className="courses-meta" role="status">{t('schoolsCount', {count: schools.length})}</p>
    {truncated && <p className="notice">{t('truncated')}</p>}
    {schools.length ? <ul className="school-list">{schools.map((school,index) => <li key={school.id} data-guide={index===0?'schools-list':undefined}>
      <Link href={path + '/' + school.handle}>
        {school.avatarKey ? <img src={mediaUrl(school.avatarKey)} alt="" width={56} height={56} loading="lazy"/> : <span className="school-initial" aria-hidden="true">{school.name.slice(0, 1).toUpperCase()}</span>}
        <span className="school-card-text"><strong>{school.name}</strong>
          <span>{[label(school.city?.name), school.district].filter(Boolean).join(' · ') || t('cityUnknown')}</span>
          <span>{t('weeklyClasses', {count: school.classes})}</span>
          {school.unclaimed && <span className="school-badge">{t('unclaimed')}</span>}</span>
      </Link></li>)}</ul> :
      <p className="notice" role="status">{city ? t('noSchoolsCity', {city: cityName(city, locale)}) : t('noSchools')}</p>}
    <p className="courses-links"><Link href={'/' + locale + '/classes' + (city ? '?city=' + encodeURIComponent(city.slug) : '')}>{t('openTimetable')}</Link></p>
  </main>;
}
