import {db} from '@dance/db';
import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {currentUser} from '../../../lib/session';
import {ApiError} from '../../../lib/api';
import {rateLimit} from '../../../lib/rate-limit';
import {candidateQuery, findCandidates, loadSearcher, PAGE_SIZE, RADII, type CandidatePage, type Ineligible} from '../../../lib/matching/search';
import {limits, touchActivity} from '../../../lib/matching/interest';
import {ReportButton} from '../../../components/moderation/report-button';
import {BlockButton, InterestButton} from '../../../components/matching/actions';
import {LocationSetting} from '../../../components/matching/location-setting';
import {Avatar, PartnersNav} from '../../../components/matching/shared';
import '../../styles/matching.css';
export const dynamic = 'force-dynamic';
// Partner search is private: never indexed, never in the sitemap.
export async function generateMetadata() {
  const t = await getTranslations('Matching');
  return {title: t('title'), robots: {index: false, follow: false}};
}
type Search = Record<string, string | string[] | undefined>;
// What to do next for each reason a visitor cannot search; anonymous visitors only ever see this explanation.
const NEXT: Record<Ineligible, {href: string; label: string} | null> = {
  UNAUTHORIZED: {href: '/login', label: 'signIn'}, VERIFY_EMAIL: null, BANNED: null, PROFILE_HIDDEN: null,
  PROFILE_REQUIRED: {href: '/onboarding', label: 'createProfile'}, LOOKING_FOR_REQUIRED: {href: '/profile#skills-title', label: 'openSkills'}
};
export default async function Partners({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<Search>}) {
  const {locale} = await params, raw = await searchParams;
  const [t, app, user] = await Promise.all([getTranslations('Matching'), getTranslations('App'), currentUser()]);
  const access = await loadSearcher(user);
  if ('reason' in access) {
    const next = NEXT[access.reason];
    return <main className="form-page partner-page"><h1>{t('title')}</h1><p className="intro">{t('intro')}</p>
      <section className="partner-explain" aria-labelledby="how-title"><h2 id="how-title">{t('howTitle')}</h2>
        <ul><li>{t('howConsent')}</li><li>{t('howReciprocity')}</li><li>{t('howPrivacy')}</li><li>{t('howInterest')}</li><li>{t('howSafety')}</li></ul></section>
      <p className="notice" role="status">{t('need_' + access.reason)}</p>
      {next && <Link className="button" href={'/' + locale + next.href}>{t(next.label)}</Link>}
    </main>;
  }
  const me = access.searcher;
  const value = (key: string) => typeof raw[key] === 'string' && raw[key] !== '' ? raw[key] as string : undefined;
  // In the form the distance choice wins over the city choice, so the two are never sent to the query together.
  const filters = {style: value('style'), subStyles: value('subStyles'), widen: value('widen'),
    radiusKm: value('radiusKm'), cityId: value('radiusKm') ? undefined : value('cityId')};
  const parsed = candidateQuery.safeParse({...filters, offset: value('offset')});
  const query = parsed.success ? parsed.data : candidateQuery.parse({});
  let page: CandidatePage | null = null, error = parsed.success ? '' : 'INVALID_INPUT';
  if (!(await rateLimit('matching:search:' + me.userId, limits.search)).ok) error = 'RATE_LIMITED';
  else try {
    page = await findCandidates(me, query);
    void touchActivity(me.profileId).catch(() => undefined);
  } catch (failure) {
    if (!(failure instanceof ApiError)) throw failure;
    error = failure.code;
  }
  const cities = await db.city.findMany({orderBy: {name: 'asc'}, select: {id: true, name: true}});
  const myStyles = [...new Map(me.skills.map(skill => [skill.styleId, skill.style])).entries()];
  const href = (offset: number) => {
    const search = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1]));
    if (offset > 0) search.set('offset', String(offset));
    const text = search.toString();
    return '/' + locale + '/partners' + (text ? '?' + text : '');
  };
  return <main className="detail-page partner-page"><h1>{t('title')}</h1><p className="intro">{t('intro')}</p>
    <PartnersNav locale={locale} current="search"/>
    <section className="partner-explain" aria-labelledby="mine-title"><h2 id="mine-title">{t('mineTitle')}</h2>
      <p>{t('mineText')}</p>
      <div className="tags">{me.skills.map(skill => <span key={skill.styleId + skill.role}>{skill.style} · {app(skill.role)} · {app(skill.level)}</span>)}</div>
      <p><Link href={'/' + locale + '/profile#skills-title'}>{t('openSkills')}</Link></p></section>
    <form className="partner-filters" method="get" action={'/' + locale + '/partners'} aria-labelledby="filters-title">
      <h2 id="filters-title">{t('filtersTitle')}</h2>
      <div className="partner-fields">
        <label>{t('filterStyle')}<select name="style" defaultValue={query.style ?? ''}>
          <option value="">{t('allMyStyles')}</option>
          {myStyles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>{t('filterCity')}<select name="cityId" defaultValue={query.cityId ?? me.cityId ?? ''}>
          {!me.cityId && <option value="">{t('chooseCity')}</option>}
          {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
        <label>{t('filterRadius')}<select name="radiusKm" defaultValue={query.radiusKm ? String(query.radiusKm) : ''} aria-describedby="radius-hint">
          <option value="">{t('radiusCity')}</option>
          {RADII.map(km => <option key={km} value={km}>{t('radiusKm', {km})}</option>)}</select>
          <small id="radius-hint" className="field-note">{t('radiusHint')}</small></label>
      </div>
      <label className="checkbox"><input type="checkbox" name="subStyles" value="1" defaultChecked={query.subStyles}/>{t('filterSubStyles')}</label>
      <label className="checkbox"><input type="checkbox" name="widen" value="1" defaultChecked={query.widen}/>{t('filterWiden')}</label>
      <p className="field-note">{t('filterRules')}</p>
      <button className="button">{t('searchButton')}</button>
    </form>
    <section aria-labelledby="results-title"><h2 id="results-title">{t('resultsTitle')}</h2>
      {error && <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
      {page && <p role="status">{t('resultsCount', {count: page.total})}</p>}
      {page && page.total === 0 && <p className="notice">{t('noResults')}</p>}
      {page && page.candidates.length > 0 && <ul className="partner-list">{page.candidates.map(candidate => {
        const place = [candidate.city, candidate.district].filter(Boolean).join(', ');
        return <li key={candidate.profileId}><article className="partner-card" aria-labelledby={'candidate-' + candidate.profileId}>
          <div className="partner-head"><Avatar name={candidate.name} avatarKey={candidate.avatarKey}/>
            <div><h3 id={'candidate-' + candidate.profileId}><Link href={'/' + locale + '/@' + candidate.handle}>{candidate.name}</Link></h3>
              <p className="partner-meta">@{candidate.handle}{place ? ' · ' + place : ''}</p>
              {candidate.distanceBand && <p className="partner-meta"><span className="visually-hidden">{t('distanceLabel')}: </span>{t('band_' + candidate.distanceBand)}</p>}</div></div>
          {candidate.bio && <p className="partner-bio">{candidate.bio}</p>}
          <ul className="tags partner-skills" aria-label={t('lookingIn')}>{candidate.skills.map(skill =>
            <li key={skill.styleId + skill.role}>{skill.style} · {app(skill.role)} · {app(skill.level)}</li>)}</ul>
          <InterestButton profileId={candidate.profileId} name={candidate.name} initial={candidate.interested}
            styleId={query.style && candidate.skills.some(skill => skill.styleId === query.style) ? query.style : undefined}/>
          <div className="partner-safety"><ReportButton targetType="PROFILE" targetId={candidate.profileId} signedIn/>
            <BlockButton profileId={candidate.profileId} name={candidate.name}/></div>
        </article></li>;
      })}</ul>}
      {page && (page.offset > 0 || page.nextOffset !== null) && <nav className="partner-pages" aria-label={t('pagesLabel')}>
        {page.offset > 0 && <Link className="button secondary" href={href(Math.max(0, page.offset - PAGE_SIZE))} rel="prev">{t('previous')}</Link>}
        {page.nextOffset !== null && <Link className="button secondary" href={href(page.nextOffset)} rel="next">{t('next')}</Link>}
      </nav>}
    </section>
    <LocationSetting located={me.hasCoordinates}/>
    <p className="field-note">{t('safetyNote')}</p>
  </main>;
}
