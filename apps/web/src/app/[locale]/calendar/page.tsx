import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {MultiFilter} from '../../../components/multi-filter';
import {CalendarView} from '../../../components/calendar/calendar-view';
import {SubscribeFeed} from '../../../components/calendar/subscribe-feed';
import {calendarCatalogue, calendarFilters} from '../../../lib/calendar/query';
import {queryParams, type SearchQuery} from '../../../lib/search-query';
import {classLevels, eventKinds} from '../../../lib/swing';
import {discoveryQuery} from '../../../lib/discovery';
import {DiscoveryNav,DiscoveryDateFields} from '../../../components/discovery-nav';
import {first} from '../../../lib/search-query';
import '../../styles/calendar.css';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Calendar'});
  return {title: t('title'), description: t('intro')};
}
// Filter state lives in the URL (?city=<slug>&style=<slug>&level=…&kind=…, all repeatable), so city and style pages can deep-link here.
export default async function CalendarPage({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<SearchQuery>}) {
  const {locale} = await params, [t, a, {cities, styles}] = await Promise.all([getTranslations('Calendar'), getTranslations('App'), calendarCatalogue()]);
  const {query}=await discoveryQuery(await searchParams);
  const filters = calendarFilters(queryParams(query));
  filters.city = filters.city.map(id=>cities.find(c=>c.id===id||c.slug===id)?.slug||id);
  filters.style = filters.style.map(id=>styles.find(s=>s.id===id||s.slug===id)?.slug||id);
  const named = (items: {slug: string; name: string}[]) => items.map(i => ({id: i.slug, name: i.name}));
  const options = (items: readonly string[], prefix: string) => items.filter(id => id !== 'UNSPECIFIED').map(id => ({id, name: a(prefix + id)}));
  const select = (name: 'city'|'style'|'level'|'kind', label: string, all: string, items: {id: string; name: string}[]) =>
    <MultiFilter key={name + filters[name].join(',')} name={name} label={a(label)} all={a(all)} items={items} initial={filters[name]}/>;
  // The subscription feed takes one city and one style; with several selected it falls back to the wider feed.
  const citySlug = filters.city.length === 1 ? filters.city[0] : undefined, styleSlug = filters.style.length === 1 ? filters.style[0] : undefined;
  const feedLabel = [cities.find(c => c.slug === citySlug)?.name, styles.find(s => s.slug === styleSlug)?.name].filter(Boolean).join(' · ');
  return <main className="calendar-page">
    <h1>{t('title')}</h1><p className="intro">{t('intro')}</p>
    <DiscoveryNav locale={locale} query={query}/>
    <form className="search-panel" action={'/' + locale + '/calendar'} aria-label={t('filtersLabel')}>
      <input type="hidden" name="city" value="all"/>
      <DiscoveryDateFields/>
      {[...queryParams(filters.extra||{})].map(([key,value],i)=><input key={i} type="hidden" name={key} value={value}/>)}
      <div className="filters">
        {select('city', 'city', 'allCities', named(cities))}{select('style', 'style', 'allStyles', named(styles))}
        {select('level', 'classLevel', 'allLevels', options(classLevels, 'level_'))}{select('kind', 'kind', 'allKinds', options(eventKinds, 'kind_'))}
      </div>
      <div className="filter-actions"><button className="button">{a('filter')}</button><a href={'/' + locale + '/calendar'}>{a('clear')}</a></div>
    </form>
    <CalendarView key={JSON.stringify(filters)} locale={locale} filters={filters} initialDate={first(query.from)||undefined}/>
    <SubscribeFeed citySlug={citySlug} styleSlug={styleSlug} name={feedLabel || undefined}/>
  </main>;
}
