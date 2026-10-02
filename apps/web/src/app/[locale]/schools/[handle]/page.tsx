import {DateTime} from 'luxon';
import {db} from '@dance/db';
import {cache} from 'react';
import Link from 'next/link';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {cityLabeler} from '../../../../lib/catalogue/data';

import {currentUser} from '../../../../lib/session';
import {siteUrl} from '../../../../lib/mail';
import {mediaUrl} from '../../../../lib/account/media';
import {safeJson} from '../../../../lib/events/jsonld';
import {isFollowing} from '../../../../lib/catalogue/follows';
import {weekOf, weekTimetable} from '../../../../lib/courses/timetable';
import {findSchool, schoolJsonLd, schoolVenues, upcomingSpecials} from '../../../../lib/courses/schools';
import {FollowButton} from '../../../../components/catalogue/follow-button';
import {WeekTimetable} from '../../../../components/courses/timetable';
import {WeekNav} from '../../../../components/courses/week-nav';
import '../../../styles/courses.css';
type Props = {params: Promise<{locale: string; handle: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
const school = cache((handle: string) => findSchool(handle));
export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {locale, handle} = await params, profile = await school(handle);
  if (!profile) return {robots: {index: false}};
  const t = await getTranslations({locale, namespace: 'Courses'}), origin = siteUrl(), path = '/schools/' + profile.handle;
  const title = t('schoolMetaTitle', {name: profile.name}), description = (profile.bio || t('schoolMetaDescription', {name: profile.name})).slice(0, 160);
  return {title, description, alternates: {canonical: origin + '/' + locale + path, languages: {en: origin + '/en' + path, es: origin + '/es' + path, ru: origin + '/ru' + path}},
    openGraph: {title, description, url: origin + '/' + locale + path, ...(profile.avatarKey ? {images: [origin + mediaUrl(profile.avatarKey)]} : {})}};
}
export default async function SchoolPage({params, searchParams}: Props) {
  const {locale, handle} = await params, profile = await school(handle);
  if (!profile) notFound();
  const rawWeek = (await searchParams).week, zone = profile.city?.timezone || 'UTC';
  const week = weekOf(Array.isArray(rawWeek) ? rawWeek[0] : rawWeek, zone), current = weekOf(null, zone);
  const [t, app, user, timetable, specials, venues] = await Promise.all([getTranslations('Courses'), getTranslations('App'), currentUser(),
    weekTimetable(week, {profileId: profile.id}), upcomingSpecials(profile.id), schoolVenues(profile.id)]);
  const own = !!user && profile.userId === user.id, following = own ? false : await isFollowing(user?.id, {profileId: profile.id});
  const origin = siteUrl(), path = '/' + locale + '/schools/' + profile.handle, label = await cityLabeler(locale), place = [label(profile.city?.name), profile.district].filter(Boolean).join(' · ');
  // An empty week is not a dead end: point to the first week in which this school has a class.
  const firstClass = timetable.total ? null : await db.eventOccurrence.findFirst({where: {cancelled: false, startsAt: {gte: new Date()},
    event: {status: 'PUBLISHED', hiddenAt: null, rrule: {not: null}, kind: {in: ['CLASS', 'PRACTICE']}, members: {some: {profileId: profile.id, role: {in: ['OWNER', 'CO_ORGANIZER', 'ARTIST']}}}}},
    orderBy: {startsAt: 'asc'}, select: {startsAt: true, event: {select: {timezone: true}}}});
  const firstWeek = firstClass ? weekOf(DateTime.fromJSDate(firstClass.startsAt, {zone: firstClass.event.timezone}).toISODate(), zone).start : null;
  const zones = new Set(timetable.days.flatMap(day => day.entries.map(entry => entry.timezone)));
  return <main className="courses-page">
    {/* JSON-LD is a data block, not executable script, so it is CSP-safe; "<" is escaped so user text cannot close the element. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: safeJson(schoolJsonLd(profile, venues, origin, origin + path))}}/>
    <nav className="courses-breadcrumbs" aria-label={t('breadcrumbs')}><ol><li><Link href={'/' + locale + '/schools'}>{t('schoolsTitle')}</Link></li>
      <li><span aria-current="page">{profile.name}</span></li></ol></nav>
    <header className="school-header">
      {profile.avatarKey ? <img src={mediaUrl(profile.avatarKey)} alt={t('logoAlt', {name: profile.name})} width={96} height={96}/> :
        <span className="school-initial school-initial-large" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span>}
      <div><p className="eyebrow">{app(profile.type)} · @{profile.handle}</p><h1>{profile.name}</h1>
        {place && <p className="intro">{place}</p>}
        {profile.userId === null && <p className="school-badge">{t('unclaimed')}</p>}</div>
    </header>
    <div className="school-actions">
      {!own && <FollowButton target={{profileId: profile.id}} initialFollowing={following} signedIn={!!user}/>}
      {own && <Link className="button" href={'/' + locale + '/events/new'}>{t('ownerAddClass')}</Link>}
      <Link className="button secondary" href={'/' + locale + '/people/' + profile.handle}>{t('fullProfile')}</Link>
    </div>
    <p className="courses-meta">{t('followersCount', {count: profile._count.followers})}{profile.userId === null ? ' · ' + t('unclaimedHint') : ''}</p>
    {profile.bio && <p className="school-bio">{profile.bio}</p>}
    <section aria-labelledby="school-timetable"><h2 id="school-timetable">{t('weeklyTimetable')}</h2>
      <WeekNav week={week} current={current} path={path} query={{}} locale={locale}/>
      {timetable.total ? <><p className="courses-meta">{t('classesCount', {count: timetable.total})} · {zones.size === 1 ? t('timesLocalZone', {zone: [...zones][0]}) : t('timesLocal')}</p>
        <WeekTimetable timetable={timetable} locale={locale} showCity={zones.size > 1} hideHost={profile.handle}/></> :
        <p className="notice" role="status">{t('noClassesSchool')}{firstWeek && firstWeek !== week.start && <> <Link href={path + '?week=' + firstWeek}>{t('classesStart', {date: new Intl.DateTimeFormat(locale, {dateStyle: 'long', timeZone: 'UTC'}).format(new Date(firstWeek + 'T00:00:00Z'))})}</Link></>}
          {own && !firstWeek && <> {t('ownerAddHint')}</>}</p>}
    </section>
    <section aria-labelledby="school-specials"><h2 id="school-specials">{t('specials')}</h2>
      {specials.length ? <ul className="school-events">{specials.map(event => <li key={event.id}><Link href={'/' + locale + '/events/' + event.slug + '?date=' + encodeURIComponent(event.startsAt.toISOString())}>
        <strong>{event.title}</strong>
        <time dateTime={event.startsAt.toISOString()}>{new Intl.DateTimeFormat(locale, {dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone}).format(event.startsAt)}</time>
        <span>{[app('kind_' + event.kind), event.level !== 'UNSPECIFIED' ? app('level_' + event.level) : '', event.venue || label(event.city.name), event.priceText].filter(Boolean).join(' · ')}</span>
      </Link></li>)}</ul> : <p className="courses-meta">{t('noSpecials')}</p>}
    </section>
    <section aria-labelledby="school-venues"><h2 id="school-venues">{t('venues')}</h2>
      {venues.length ? <ul className="school-venues">{venues.map(venue => <li key={venue.id}><Link href={'/' + locale + '/venues/' + venue.id}><strong>{venue.name}</strong>
        <span>{venue.address}, {label(venue.city.name)}</span></Link></li>)}</ul> : <p className="courses-meta">{t('noVenues')}</p>}
    </section>
  </main>;
}
