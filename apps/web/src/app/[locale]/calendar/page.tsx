import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {MultiFilter} from '../../../components/multi-filter';
import {CalendarView} from '../../../components/calendar/calendar-view';
import {SubscribeFeed} from '../../../components/calendar/subscribe-feed';
import {calendarCatalogue, calendarFilters} from '../../../lib/calendar/query';
import {queryParams, type SearchQuery} from '../../../lib/search-query';
import {classLevels, eventKinds} from '../../../lib/swing';
import '../../styles/calendar.css';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Calendar'});
  return {title: t('title'), description: t('intro')};
}
// Filter state lives in the URL (?city=<slug>&style=<slug>&level=…&kind=…, all repeatable), so city and style pages can deep-link here.
export default async function CalendarPage({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<SearchQuery>}) {
  const {locale} = await params, [t, a, {cities, styles}] = await Promise.all([getTranslations('Calendar'), getTranslations('App'), calendarCatalogue()]);
  const filters = calendarFilters(queryParams(await searchParams));
  filters.city = filters.city.filter(slug => cities.some(c => c.slug === slug));
  filters.style = filters.style.filter(slug => styles.some(s => s.slug === slug));
  const named = (items: {slug: string; name: string}[]) => items.map(i => ({id: i.slug, name: i.name}));
  const options = (items: readonly string[], prefix: string) => items.filter(id => id !== 'UNSPECIFIED').map(id => ({id, name: a(prefix + id)}));
  const select = (name: keyof typeof filters, label: string, all: string, items: {id: string; name: string}[]) =>
    <MultiFilter key={name + filters[name].join(',')} name={name} label={a(label)} all={a(all)} items={items} initial={filters[name]}/>;
  // The subscription feed takes one city and one style; with several selected it falls back to the wider feed.
  const citySlug = filters.city.length === 1 ? filters.city[0] : undefined, styleSlug = filters.style.length === 1 ? filters.style[0] : undefined;
  const feedLabel = [cities.find(c => c.slug === citySlug)?.name, styles.find(s => s.slug === styleSlug)?.name].filter(Boolean).join(' · ');
  return <main className="calendar-page">
    <h1>{t('title')}</h1><p className="intro">{t('intro')}</p>
    <form className="search-panel" action={'/' + locale + '/calendar'} aria-label={t('filtersLabel')}>
      <div className="filters">
        {select('city', 'city', 'allCities', named(cities))}{select('style', 'style', 'allStyles', named(styles))}
        {select('level', 'classLevel', 'allLevels', options(classLevels, 'level_'))}{select('kind', 'kind', 'allKinds', options(eventKinds, 'kind_'))}
      </div>
      <div className="filter-actions"><button className="button">{a('filter')}</button><a href={'/' + locale + '/calendar'}>{a('clear')}</a></div>
    </form>
    <CalendarView key={JSON.stringify(filters)} locale={locale} filters={filters}/>
    <SubscribeFeed citySlug={citySlug} styleSlug={styleSlug} name={feedLabel || undefined}/>
  </main>;
}
