import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {first, type SearchQuery} from '../../../../lib/search-query';
import {VenueForm} from '../../../../components/geo/venue-form';
import '../../../styles/geo.css';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, t = await getTranslations({locale, namespace: 'Geo'});
  return {title: t('venueNewTitle')};
}
export default async function NewVenue({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<SearchQuery>}) {
  const {locale} = await params, query = await searchParams, t = await getTranslations('Geo'), app = await getTranslations('App');
  const [user, cities] = await Promise.all([currentUser(), db.city.findMany({orderBy: {name: 'asc'}, select: {id: true, name: true, lat: true, lng: true}})]);
  return <main><section className="form-page">
    <p className="eyebrow">{t('venues')}</p><h1>{t('venueNewTitle')}</h1><p className="intro">{t('venueNewText')}</p>
    {user ? <VenueForm cities={cities} initialCityId={cities.some(city => city.id === first(query.cityId)) ? first(query.cityId) : undefined}/>
      : <p className="notice">{t('signInToAdd')} <Link href={'/' + locale + '/login'}>{app('signIn')}</Link></p>}
  </section></main>;
}
