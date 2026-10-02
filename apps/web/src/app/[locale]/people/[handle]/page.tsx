import {db} from '@dance/db';
import {cache} from 'react';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {cityLabeler} from '../../../../lib/catalogue/data';

import {notFound} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {siteUrl} from '../../../../lib/mail';
import {mediaUrl} from '../../../../lib/account/media';
import {profileJsonLd, safeJson} from '../../../../lib/account/jsonld';
import {canClaimProfile, canEditProfile} from '../../../../lib/account/permissions';
import {ClaimForm} from '../../../../components/account/claim-form';
import {ProfilePosts} from '../../../../components/blog/profile-posts';
import {FollowButton} from '../../../../components/catalogue/follow-button';
import {MessageButton} from '../../../../components/chat/message-button';
import {ReportButton} from '../../../../components/moderation/report-button';
import {isFollowing} from '../../../../lib/catalogue/follows';
import '../../../styles/account.css';
type Params = {params: Promise<{locale: string; handle: string}>};
// Public fields only: coordinates and the owner's email are never selected. Moderated profiles do not exist publicly.
const publicProfile = cache((handle: string) => db.profile.findFirst({where: {handle: handle.toLowerCase(), hiddenAt: null}, select: {
  id: true, userId: true, name: true, handle: true, type: true, bio: true, instagram: true, avatarKey: true, coverKey: true, district: true,
  city: {select: {name: true, countryCode: true}},
  skills: {orderBy: {style: {name: 'asc'}}, select: {role: true, level: true, style: {select: {name: true}}}}}}));
export async function generateMetadata({params}: Params): Promise<Metadata> {
  const {locale, handle} = await params, profile = await publicProfile(handle);
  if (!profile) return {robots: {index: false}};
  const t = await getTranslations({locale, namespace: 'Account'}), app = await getTranslations({locale, namespace: 'App'});
  const origin = siteUrl(), canonical = origin + '/@' + profile.handle;
  const place = [(await cityLabeler(locale))(profile.city?.name), profile.district].filter(Boolean).join(', ');
  const description = (profile.bio || (place ? t('metaDescription', {name: profile.name, type: app(profile.type), place}) :
    t('metaDescriptionNoPlace', {name: profile.name, type: app(profile.type)}))).slice(0, 160);
  const title = profile.name + ' (@' + profile.handle + ')';
  return {title, description,
    alternates: {canonical, languages: {en: origin + '/en/@' + profile.handle, es: origin + '/es/@' + profile.handle, ru: origin + '/ru/@' + profile.handle, 'x-default': canonical}},
    openGraph: {title, description, url: canonical, type: 'profile', ...(profile.avatarKey ? {images: [origin + mediaUrl(profile.avatarKey)]} : {})}};
}
export default async function PublicProfile({params}: Params) {
  const {locale, handle} = await params, profile = await publicProfile(handle);
  if (!profile) notFound();
  const now = new Date();
  const [t, app, user, events] = await Promise.all([getTranslations('Account'), getTranslations('App'), currentUser(),
    db.event.findMany({where: {status: 'PUBLISHED', hiddenAt: null,
      members: {some: {profileId: profile.id, role: {in: ['OWNER', 'CO_ORGANIZER']}}},
      OR: [{startsAt: {gte: now}}, {occurrences: {some: {startsAt: {gte: now}, cancelled: false}}}]},
      orderBy: {startsAt: 'asc'}, take: 12,
      select: {id: true, slug: true, title: true, startsAt: true, timezone: true, city: {select: {name: true}},
        occurrences: {where: {startsAt: {gte: now}, cancelled: false}, orderBy: {startsAt: 'asc'}, take: 1, select: {startsAt: true}}}})]);
  const stub = profile.userId === null, own = !!user && canEditProfile(user.id, profile);
  const claim = stub && user ? await db.profileClaim.findUnique({where: {profileId_userId: {profileId: profile.id, userId: user.id}}, select: {status: true}}) : null;
  const upcoming = events.map(e => ({...e, next: e.occurrences[0]?.startsAt ?? e.startsAt})).sort((a, b) => a.next.getTime() - b.next.getTime());
  const label = await cityLabeler(locale), place = [label(profile.city?.name), profile.district].filter(Boolean).join(' · ');
  return <main className="detail-page">
    {/* JSON-LD is a data block, not executable script, so it is CSP-safe; "<" is escaped so user text cannot close the element. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: safeJson(profileJsonLd(profile, siteUrl()))}}/>
    {profile.coverKey && <img className="profile-cover" src={mediaUrl(profile.coverKey)} alt={t('coverAlt', {name: profile.name})}/>}
    {profile.avatarKey ? <img className="profile-photo" src={mediaUrl(profile.avatarKey)} alt={t('avatarAlt', {name: profile.name})}/> :
      <div className="profile-avatar" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</div>}
    {stub && <p className="profile-badge">{t('unclaimed')}</p>}
    <p className="eyebrow">{app(profile.type)} · @{profile.handle}</p><h1>{profile.name}</h1>
    {place && <p className="intro">{place}</p>}
    <div className="profile-actions">
      {own && <Link className="button" href={'/' + locale + '/profile'}>{app('editProfile')}</Link>}
      {/* Courses: schools, venues and organizers have a page with their weekly timetable. */}
      {['SCHOOL', 'VENUE', 'ORGANIZER'].includes(profile.type) && <Link className="button secondary" href={'/' + locale + '/schools/' + profile.handle}>{(await getTranslations('Courses'))('viewTimetable')}</Link>}
      {!own && <FollowButton target={{profileId: profile.id}} initialFollowing={await isFollowing(user?.id, {profileId: profile.id})} signedIn={!!user}/>}
      {!own && !stub && <MessageButton profileId={profile.id} signedIn={!!user}/>}
      {!own && <ReportButton targetType="PROFILE" targetId={profile.id} signedIn={!!user}/>}
    </div>
    <p className="prose">{profile.bio || app('noBio')}</p>
    {profile.instagram && <p><a href={'https://www.instagram.com/' + profile.instagram + '/'} rel="nofollow ugc noopener noreferrer" target="_blank">
      {t('instagramLink', {username: profile.instagram})}</a></p>}
    {profile.skills.length > 0 && <section className="profile-section" aria-labelledby="skills-title"><h2 id="skills-title">{app('skill')}</h2>
      <div className="tags">{profile.skills.map((s, i) => <span key={i}>{s.style.name} · {app(s.role)} · {app(s.level)}</span>)}</div></section>}
    <section className="profile-section" aria-labelledby="events-title"><h2 id="events-title">{t('upcomingEvents')}</h2>
      {upcoming.length ? <ul className="profile-events">{upcoming.map(e => <li key={e.id}><Link href={'/' + locale + '/events/' + e.slug}>
        <strong>{e.title}</strong><time dateTime={e.next.toISOString()}>{new Intl.DateTimeFormat(locale, {dateStyle: 'full', timeStyle: 'short', timeZone: e.timezone}).format(e.next)} · {label(e.city.name)}</time>
      </Link></li>)}</ul> : <p className="field-note">{t('noUpcomingEvents')}</p>}
    </section>
    <ProfilePosts profileId={profile.id} handle={profile.handle} locale={locale} own={own}/>
    {stub && <section className="account-section" aria-labelledby="claim-title"><h2 id="claim-title">{t('claimTitle')}</h2><p>{t('claimText')}</p>
      {!user ? <Link className="button" href={'/' + locale + '/login'}>{t('claimSignIn')}</Link> :
        claim ? <p className="notice" role="status">{t('claim_' + claim.status)}</p> :
        user.profile || !canClaimProfile(user.id, profile) ? <p className="notice">{t('error_CLAIM_HAS_PROFILE')}</p> :
        !user.emailVerified ? <p className="notice">{app('error_VERIFY_EMAIL')}</p> : <ClaimForm handle={profile.handle}/>}
    </section>}
  </main>;
}
