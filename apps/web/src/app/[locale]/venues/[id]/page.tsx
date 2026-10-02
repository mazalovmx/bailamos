import {cache} from 'react';
import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {cityLabeler} from '../../../../lib/catalogue/data';

import {notFound} from 'next/navigation';
import Link from 'next/link';
import {EventCard} from '../../../../components/event-card';
import {LocationMap} from '../../../../components/geo/location-map';
import '../../../styles/geo.css';
const venueById = cache((id: string) => db.venue.findFirst({where: {id, hiddenAt: null}, include: {city: true}}));
export async function generateMetadata({params}: {params: Promise<{id: string}>}) {
  const venue = await venueById((await params).id);
  return venue ? {title: venue.name, description: venue.address} : {};
}
export default async function VenuePage({params}: {params: Promise<{locale: string; id: string}>}) {
  const {locale, id} = await params, t = await getTranslations('Geo'), venue = await venueById(id);
  if (!venue) notFound();
  const cityLabel = (await cityLabeler(locale))(venue.city.name);
  const sessions = await db.eventOccurrence.findMany({
    where: {cancelled: false, startsAt: {gte: new Date()}, event: {venueId: venue.id, status: 'PUBLISHED', hiddenAt: null}},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: 24, include: {event: {include: {city: true, styles: {include: {style: true}}}}}
  });
  return <main className="detail-page">
    <p className="eyebrow">{t('venueEyebrow')}</p><h1>{venue.name}</h1>
    <address className="geo-address">{venue.address}<br/>{cityLabel}</address>
    <LocationMap lat={venue.lat} lng={venue.lng} label={venue.name + ', ' + venue.address}/>
    <section className="event-section" style={{marginTop: 40}}><h2>{t('venueEvents')}</h2>
      {sessions.length ? <div className="event-grid">{sessions.map(session => <EventCard key={session.id} event={session.event} displayDate={session.startsAt} locale={locale}/>)}</div>
        : <p className="notice">{t('venueNoEvents')}</p>}
      <p><Link href={'/' + locale + '/map?city=' + encodeURIComponent(venue.city.slug)}>{t('venueCityMap', {city: cityLabel})}</Link></p>
    </section>
  </main>;
}
