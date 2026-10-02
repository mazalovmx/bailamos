import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {db} from '@dance/db';
import {allCities, upcomingOccurrences} from '../../../../lib/catalogue/data';
import {cityName} from '../../../../lib/catalogue/city-name';
import {currentCitySlug} from '../../../../lib/catalogue/current-city';
import {isFollowing} from '../../../../lib/catalogue/follows';
import {currentUser} from '../../../../lib/session';
import {EventCard} from '../../../../components/event-card';
import {FollowButton} from '../../../../components/catalogue/follow-button';
import {UseCityButton} from '../../../../components/catalogue/city-switcher';
import '../../../styles/catalogue.css';
type Props = {params: Promise<{locale: string; slug: string}>};
export async function generateMetadata({params}: Props) {
  const {locale, slug} = await params, city = (await allCities()).find(item => item.slug === slug);
  if (!city) return {};
  const t = await getTranslations({locale, namespace: 'Catalogue'}), name = cityName(city, locale);
  return {title: t('cityAgendaTitle', {name}), description: t('cityDescription', {name})};
}
export default async function City({params}: Props) {
  const {locale, slug} = await params, city = (await allCities()).find(item => item.slug === slug);
  if (!city) notFound();
  const t = await getTranslations('Catalogue'), name = cityName(city, locale), user = await currentUser(), where = upcomingOccurrences({cityId: city.id});
  const [occurrences, total, followers, following, mine] = await Promise.all([
    db.eventOccurrence.findMany({where, orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: 30, include: {event: {include: {city: true, styles: {include: {style: true}}}}}}),
    db.eventOccurrence.count({where}), db.follow.count({where: {cityId: city.id}}), isFollowing(user?.id, {cityId: city.id}), currentCitySlug()]);
  // The agenda is grouped by calendar day in the city's own time zone, not the visitor's.
  const dayKey = new Intl.DateTimeFormat('en-CA', {timeZone: city.timezone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const dayName = new Intl.DateTimeFormat(locale, {timeZone: city.timezone, dateStyle: 'full'});
  const days = new Map<string, typeof occurrences>();
  for (const occurrence of occurrences) days.set(dayKey.format(occurrence.startsAt), [...(days.get(dayKey.format(occurrence.startsAt)) || []), occurrence]);
  let country: string = city.countryCode;
  try {country = new Intl.DisplayNames([locale], {type: 'region'}).of(city.countryCode) || country;} catch {/* keep the code */}
  const q = '?city=' + encodeURIComponent(city.slug);
  return <main className="catalogue-page">
    <nav className="breadcrumbs" aria-label={t('breadcrumbs')}><ol><li><Link href={'/' + locale + '/cities'}>{t('citiesTitle')}</Link></li><li><span aria-current="page">{name}</span></li></ol></nav>
    <p className="eyebrow">{country}</p><h1>{name}</h1>
    {name !== city.name && <p className="catalogue-meta">{t('localCityName', {name: city.name})}</p>}
    <p className="catalogue-meta">{t('cityTimezone', {zone: city.timezone})} · {t('followersCount', {count: followers})}</p>
    <div className="catalogue-actions"><FollowButton target={{cityId: city.id}} initialFollowing={following} signedIn={!!user}/>
      <UseCityButton slug={city.slug} active={mine === city.slug}/></div>
    <div className="tags"><Link href={'/' + locale + '/calendar' + q}>{t('openCalendar')}</Link><Link href={'/' + locale + '/map' + q}>{t('openMap')}</Link>
      <a href={'/api/feeds/ical' + q}>{t('subscribeIcal')}</a></div>
    <section aria-labelledby="city-agenda"><h2 id="city-agenda">{t('agenda')}</h2>
      {occurrences.length ? [...days.entries()].map(([key, list]) => <section className="agenda-day" key={key} aria-labelledby={'day-' + key}>
        <h3 id={'day-' + key}><time dateTime={key}>{dayName.format(list[0].startsAt)}</time></h3>
        <div className="event-grid">{list.map(occurrence => <EventCard key={occurrence.id} event={occurrence.event} displayDate={occurrence.startsAt} locale={locale}/>)}</div>
      </section>) : <p className="notice" role="status">{t('noEventsInCity')}</p>}
      {total > occurrences.length && <p className="catalogue-meta">{t('moreEvents', {count: total - occurrences.length})}</p>}
      <p><Link href={'/' + locale + '/events?city=' + encodeURIComponent(city.id)}>{t('allEventsInCity')}</Link></p>
    </section>
  </main>;
}
