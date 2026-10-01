import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {db} from '@dance/db';
import {localizedCities} from '../../../lib/catalogue/data';
import {cityAliases} from '../../../lib/catalogue/city-name';
import {currentCity} from '../../../lib/catalogue/current-city';
import {rankMatches} from '../../../lib/catalogue/search';
import {CitySwitcher} from '../../../components/catalogue/city-switcher';
import '../../styles/catalogue.css';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Catalogue'});
  return {title: t('citiesTitle'), description: t('citiesIntro')};
}
export default async function Cities({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const {locale} = await params, raw = (await searchParams).q, q = (Array.isArray(raw) ? raw[0] : raw || '').slice(0,80).trim();
  const t = await getTranslations('Catalogue');
  const [cities, current, active] = await Promise.all([localizedCities(locale), currentCity(),
    db.event.groupBy({by: ['cityId'], _count: {_all: true}, where: {status: 'PUBLISHED', hiddenAt: null, occurrences: {some: {cancelled: false, startsAt: {gte: new Date()}}}}})]);
  const counts = new Map(active.map(row => [row.cityId, row._count._all])), regions = new Intl.DisplayNames([locale], {type: 'region'});
  const country = (code: string) => {try {return regions.of(code) || code;} catch {return code;}};
  type Row = typeof cities[number];
  const mine = current && cities.find(city => city.id === current.id), groups = new Map<string, Row[]>();
  for (const city of q ? rankMatches(cities, q, 60, cityAliases) : cities) groups.set(city.countryCode, [...(groups.get(city.countryCode) || []), city]);
  const item = (city: Row) => <li key={city.id}><Link href={'/' + locale + '/cities/' + city.slug} aria-current={current?.id === city.id ? 'true' : undefined}>
    <span>{city.name}{city.localName !== city.name && <small> {city.localName}</small>}</span>{counts.get(city.id) ? <small>{t('eventsCount', {count: counts.get(city.id)!})}</small> : null}</Link></li>;
  return <main className="catalogue-page"><p className="eyebrow">{t('directory')}</p><h1>{t('citiesTitle')}</h1><p className="intro">{t('citiesIntro')}</p>
    <CitySwitcher current={mine ? {slug: mine.slug, name: mine.name} : null}/>
    {mine && <p><Link href={'/' + locale + '/cities/' + mine.slug}>{t('openCityAgenda', {name: mine.name})}</Link></p>}
    <form className="catalogue-search" role="search" action={'/' + locale + '/cities'}>
      <label>{t('searchCities')}<input type="search" name="q" defaultValue={q} maxLength={80}/></label>
      <button className="button">{t('search')}</button>{q && <Link href={'/' + locale + '/cities'}>{t('showAll')}</Link>}
    </form>
    <p className="catalogue-meta">{q ? t('resultsFor', {query: q}) : t('citiesCount', {count: cities.length})}</p>
    {!groups.size && <p className="notice" role="status">{t('noResults')}</p>}
    {[...groups.entries()].map(([code, list]) => [country(code), code, list] as const).sort((a,b) => a[0].localeCompare(b[0], locale)).map(([name, code, list]) =>
      <section className="country-group" key={code} aria-labelledby={'country-' + code}><h2 id={'country-' + code}>{name}</h2>
        <ul className="link-list">{list.map(item)}</ul></section>)}
  </main>;
}
