import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {headers} from 'next/headers';
import {DateTime} from 'luxon';
import {locate} from '../../../lib/geo/locate';
import {first, type SearchQuery} from '../../../lib/search-query';
import {MapExplorer} from '../../../components/geo/map-explorer';
import '../../styles/geo.css';
const radii = [5, 10, 25, 50, 100], day = /^\d{4}-\d{2}-\d{2}$/;
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, t = await getTranslations({locale, namespace: 'Geo'});
  return {title: t('mapTitle'), description: t('mapText')};
}
export default async function MapPage({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<SearchQuery>}) {
  const {locale} = await params, query = await searchParams, t = await getTranslations('Geo');
  const [cities, styles, located] = await Promise.all([
    db.city.findMany({orderBy: {name: 'asc'}, select: {id: true, slug: true, name: true, lat: true, lng: true, timezone: true}}),
    db.danceStyle.findMany({orderBy: {name: 'asc'}, select: {id: true, name: true}}),
    locate(await headers())
  ]);
  // ?city= wins; otherwise the city chosen in the switcher (cookie). A merely detected city centres the map without filtering.
  const chosen = cities.find(city => city.slug === first(query.city)) || (first(query.city) || located.source !== 'cookie' ? undefined : cities.find(city => city.slug === located.city?.slug));
  const focus = chosen || located.city;
  const today = DateTime.now().setZone(chosen?.timezone || 'UTC'), defaults = {from: today.toISODate()!, to: today.plus({days: 7}).toISODate()!};
  const from = first(query.from), to = first(query.to), valid = day.test(from) && day.test(to) && DateTime.fromISO(from).isValid && DateTime.fromISO(to).isValid && to >= from;
  const radius = Number(first(query.radius));
  return <main className="geo-page">
    <p className="eyebrow">{t('mapEyebrow')}</p><h1>{t('mapTitle')}</h1><p className="intro">{t('mapText')}</p>
    <MapExplorer locale={locale} cities={cities.map(({id, slug, name, lat, lng}) => ({id, slug, name, lat, lng}))} styles={styles} defaults={defaults}
      initial={{city: chosen?.slug || '', style: styles.some(style => style.id === first(query.style)) ? first(query.style) : '', ...(valid ? {from, to} : defaults), radius: radii.includes(radius) ? radius : 0}}
      centre={focus ? {lat: focus.lat, lng: focus.lng, zoom: 11} : {lat: 30, lng: 0, zoom: 1.3}}/>
  </main>;
}
