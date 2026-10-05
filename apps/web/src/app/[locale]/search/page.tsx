import Link from 'next/link';
import {redirect} from 'next/navigation';
import {currentCitySlug} from '../../../lib/catalogue/current-city';
import {queryParams} from '../../../lib/search-query';
import {headers} from 'next/headers';
import {getTranslations} from 'next-intl/server';
import {ZodError} from 'zod';
import {ApiError} from '../../../lib/api';
import {currentUser} from '../../../lib/session';
import {clientIp} from '../../../lib/rate-limit';
import {localizedCities} from '../../../lib/catalogue/data';
import {parseSearch, search, searchRateLimit, searchTypes, type Hit, type SearchResult, type SearchType} from '../../../lib/search/search';
import {cleanQuery, searchable} from '../../../lib/search/text';
import {CityAutocomplete} from '../../../components/catalogue/city-autocomplete';
import {Highlight} from '../../../components/search/highlight';
import '../../../components/search/search.css';
type Props = {params: Promise<{locale: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
export async function generateMetadata({params}: Props) {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Search'});
  // Result pages are endless variations of the same content: keep them out of search engines.
  return {title: t('title'), description: t('intro'), robots: {index: false, follow: true}};
}
export default async function SearchPage({params, searchParams}: Props) {
  const {locale} = await params, raw = await searchParams, t = await getTranslations('Search');
  if(raw.city===undefined)raw.city=await currentCitySlug()||undefined;
  if(['style','level','from','to','kind','format','tag','recurring'].some(key=>raw[key]))redirect('/'+locale+'/events?'+queryParams(raw));
  const one = (key: string) => {const value = raw[key]; return (Array.isArray(value) ? value[0] : value) || '';};
  const q = cleanQuery(one('q')), query = new URLSearchParams({q, locale});
  for (const key of ['type', 'city', 'cursor']) if (one(key)) query.set(key, one(key));
  let result: SearchResult | null = null, error = '';
  if (searchable(q)) try {
    const user = await currentUser(), limit = await searchRateLimit(clientIp(new Request('http://localhost', {headers: await headers()})), user?.id);
    if (!limit.ok) throw new ApiError('RATE_LIMITED', 429);
    result = await search(parseSearch(query), user?.profile?.id);
  } catch (failure) {
    error = failure instanceof ApiError ? failure.code : failure instanceof ZodError ? 'INVALID_INPUT' : 'GENERIC';
    if (error === 'GENERIC') console.error(JSON.stringify({level: 'error', event: 'search_failed', message: failure instanceof Error ? failure.message : 'unknown'}));
  } else if (q) error = 'QUERY_TOO_SHORT';
  const type = result?.type || 'all', offset = result && type !== 'all' ? Number(one('cursor')) || 0 : 0;
  const cityId = result?.city?.id || '', chosen = one('city') && !result ? (await localizedCities(locale)).find(city => city.id === one('city') || city.slug === one('city')) : null;
  const href = (next: {type?: string; cursor?: string | null}) => '/' + locale + '/search?' + new URLSearchParams({q, ...(next.type && next.type !== 'all' ? {type: next.type} : {}),
    ...(cityId ? {city: cityId} : {}), ...(next.cursor ? {cursor: next.cursor} : {})});
  const date = (hit: Hit) => hit.startsAt ? new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short', timeZone: hit.timezone}).format(new Date(hit.startsAt)) : '';
  const meta = (hit: Hit) => [hit.type === 'events' ? date(hit) : '', hit.type === 'events' && hit.upcoming === false ? t('past') : '', hit.venue,
    hit.type === 'people' || hit.type === 'schools' ? '@' + hit.handle : '', hit.type === 'posts' && hit.author ? t('by', {name: hit.author}) : '',
    hit.type === 'posts' && hit.publishedAt ? new Intl.DateTimeFormat(locale, {dateStyle: 'medium'}).format(new Date(hit.publishedAt)) : '', hit.city].filter(Boolean).join(' · ');
  const item = (hit: Hit) => <li className="search-hit" key={hit.type + hit.id}>
    <p className="search-kind">{t('kind_' + hit.type)}</p>
    <h3><Link href={'/' + locale + hit.path}><Highlight segments={hit.title}/></Link></h3>
    {meta(hit) && <p className="search-meta">{meta(hit)}</p>}
    {hit.snippet && <p><Highlight segments={hit.snippet}/></p>}
  </li>;
  const count = (key: SearchType | 'all') => result ? key === 'all' ? result.total : result.counts[key] : 0;
  return <main className="search-page">
    <h1>{t('title')}</h1><p className="intro">{t('intro')}</p>
    <form className="search-form" role="search" action={'/' + locale + '/search'} method="get">
      <label>{t('label')}<input type="search" name="q" defaultValue={q} maxLength={100} minLength={2} required placeholder={t('placeholder')} autoComplete="off"/></label>
      <CityAutocomplete name="city" label={t('cityFilter')} initialId={result?.city?.id || chosen?.id} initialName={result?.city?.name || chosen?.name}/>
      {type !== 'all' && <input type="hidden" name="type" value={type}/>}
      <button className="button">{t('submit')}</button>
    </form>
    {error && <p className="form-error" role="alert">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
    {!q && !error && <p className="notice" role="status">{t('start')}</p>}
    {result && <>
      <nav className="search-tabs" aria-label={t('tabs')}>{(['all', ...searchTypes] as const).map(key =>
        <Link key={key} href={href({type: key})} aria-current={key === type ? 'page' : undefined}>{t('type_' + key)} <span>{count(key)}</span></Link>)}</nav>
      <p className="search-status" role="status" aria-live="polite">{t('resultsCount', {count: count(type), query: result.q})}{result.city ? ' · ' + t('inCity', {city: result.city.name}) : ''}
        {offset > 0 ? ' · ' + t('pageFrom', {from: offset + 1}) : ''}</p>
      {!result.total && <div className="notice"><p>{t('noResults', {query: result.q})}</p><p>{t('noResultsHint')}</p>
        {result.city && <p><Link href={'/' + locale + '/search?' + new URLSearchParams({q})}>{t('anyCity')}</Link></p>}</div>}
      {result.total > 0 && type !== 'all' && !result.groups[type].length && <p className="notice">{t('noResultsInTab')}</p>}
      {type === 'all' ? searchTypes.filter(key => result.groups[key].length).map(key => <section className="search-group" key={key} aria-labelledby={'search-' + key}>
        <h2 id={'search-' + key}>{t('type_' + key)}</h2><ul className="search-results">{result.groups[key].map(item)}</ul>
        {result.counts[key] > result.groups[key].length && <p className="search-more"><Link href={href({type: key})}>{t('showAll', {count: result.counts[key]})}</Link></p>}
      </section>) : <ul className="search-results">{result.groups[type].map(item)}</ul>}
      {type !== 'all' && (offset > 0 || result.nextCursor) && <nav className="search-more" aria-label={t('pagination')}>
        {offset > 0 && <Link href={href({type})}>{t('firstPage')}</Link>}
        {result.nextCursor && <Link href={href({type, cursor: result.nextCursor})} rel="next">{t('nextPage')}</Link>}</nav>}
    </>}
  </main>;
}
