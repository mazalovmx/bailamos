import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {db} from '@dance/db';
import {allStyles, upcomingOccurrences} from '../../../../lib/catalogue/data';
import {ancestors, descendantIds} from '../../../../lib/catalogue/tree';
import {currentCity} from '../../../../lib/catalogue/current-city';
import {isFollowing} from '../../../../lib/catalogue/follows';
import {currentUser} from '../../../../lib/session';
import {EventCard} from '../../../../components/event-card';
import {FollowButton} from '../../../../components/catalogue/follow-button';
import '../../../styles/catalogue.css';
type Props = {params: Promise<{locale: string; slug: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
export async function generateMetadata({params}: Props) {
  const {locale, slug} = await params, style = (await allStyles()).find(item => item.slug === slug);
  if (!style) return {};
  const t = await getTranslations({locale, namespace: 'Catalogue'});
  return {title: style.name, description: t('styleDescription', {name: style.name})};
}
export default async function Style({params, searchParams}: Props) {
  const {locale, slug} = await params, styles = await allStyles(), style = styles.find(item => item.slug === slug);
  if (!style) notFound();
  const t = await getTranslations('Catalogue'), [user, city, query] = await Promise.all([currentUser(), currentCity(), searchParams]);
  // With a chosen city the page starts with local events; ?everywhere=1 widens it again.
  const local = city && query.everywhere !== '1' ? city : null;
  const ids = descendantIds(styles, style.id), where = upcomingOccurrences({styles: {some: {styleId: {in: ids}}}, ...(local ? {cityId: local.id} : {})});
  const [occurrences, total, followers, following] = await Promise.all([
    db.eventOccurrence.findMany({where, orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: 12, include: {event: {include: {city: true, styles: {include: {style: true}}}}}}),
    db.eventOccurrence.count({where}), db.follow.count({where: {styleId: style.id}}), isFollowing(user?.id, {styleId: style.id})]);
  const path = ancestors(styles, style.id), children = styles.filter(item => item.parentId === style.id), base = '/' + locale + '/styles/';
  return <main className="catalogue-page">
    <nav className="breadcrumbs" aria-label={t('breadcrumbs')}><ol><li><Link href={'/' + locale + '/styles'}>{t('stylesTitle')}</Link></li>
      {path.map(item => <li key={item.id}>{item.id === style.id ? <span aria-current="page">{item.name}</span> : <Link href={base + item.slug}>{item.name}</Link>}</li>)}</ol></nav>
    <p className="eyebrow">{t('danceStyle')}</p><h1>{style.name}</h1>
    <p className="catalogue-meta">{t('followersCount', {count: followers})}</p>
    <div className="catalogue-actions"><FollowButton target={{styleId: style.id}} initialFollowing={following} signedIn={!!user}/>
      <Link className="button secondary" href={'/' + locale + '/calendar?style=' + encodeURIComponent(style.slug)}>{t('openCalendar')}</Link></div>
    {children.length > 0 && <section aria-labelledby="sub-styles"><h2 id="sub-styles">{t('subStyles')}</h2>
      <div className="tags">{children.map(child => <Link key={child.id} href={base + child.slug}>{child.name}</Link>)}</div></section>}
    <section aria-labelledby="style-events"><h2 id="style-events">{local ? t('upcomingInCity', {city: local.name}) : t('upcomingEvents')}</h2>
      {ids.length > 1 && <p className="catalogue-meta">{t('includesSubStyles', {count: ids.length - 1})}</p>}
      {local ? <p><Link href={base + style.slug + '?everywhere=1'}>{t('showEverywhere')}</Link></p>
        : city && <p><Link href={base + style.slug}>{t('showOnlyCity', {city: city.name})}</Link></p>}
      {occurrences.length ? <div className="event-grid">{occurrences.map(occurrence => <EventCard key={occurrence.id} event={occurrence.event} displayDate={occurrence.startsAt} locale={locale}/>)}</div>
        : <p className="notice" role="status">{t('noEventsInStyle')}</p>}
      {total > occurrences.length && <p className="catalogue-meta">{t('moreEvents', {count: total - occurrences.length})}</p>}
      <p><Link href={'/' + locale + '/events?' + new URLSearchParams([['style', style.id], ...(local ? [['city', local.id]] : [])])}>{t('allEventsInStyle')}</Link></p>
    </section>
  </main>;
}
