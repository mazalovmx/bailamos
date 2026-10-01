'use client';
import {useState} from 'react';
import {useCustom} from '@refinedev/core';
import Link from 'next/link';
import {api, errorCode} from '../lib/data-provider';
import {useDate} from './cells';
import {useT} from './i18n';
import {usePanel} from './panel';
import {ReasonDialog, type Ask} from './reason-dialog';
type Claim = {
  id: string; message: string | null; createdAt: string; blocked: string | null;
  profile: {id: string; handle: string; name: string; type: string; userId: string | null; city: {name: string} | null};
  user: {id: string; name: string; email: string; bannedAt: string | null; createdAt: string; profile: {id: string; handle: string} | null};
};
export function Claims() {
  const {t, has, locale} = useT(), {webUrl} = usePanel(), date = useDate(), [ask, setAsk] = useState<Ask | null>(null);
  const {result, query} = useCustom<{data: Claim[]; total: number}>({url: '/api/claims', method: 'get'});
  const claims = result.data?.data ?? [];
  const decide = (claim: Claim, approve: boolean) => setAsk({
    title: t(approve ? 'confirmClaimApprove' : 'confirmClaimReject', {name: claim.profile.name, user: claim.user.name}),
    text: approve ? t('claimApproveText') : undefined, confirm: t(approve ? 'approve' : 'reject'), reason: approve ? 'none' : 'required',
    run: async reason => {await api('/api/claims/' + encodeURIComponent(claim.id), {method: 'POST', body: {approve, reason: reason || undefined}}); void query.refetch();}});
  return <>
    <h1>{t('nav.claims')}</h1>
    <p className="muted">{t('claimsIntro')}</p>
    {query.isError && <p role="alert" className="error">{has('error.' + errorCode(query.error)) ? t('error.' + errorCode(query.error)) : t('error.GENERIC')}</p>}
    <p role="status" className="muted">{query.isLoading ? t('loading') : t('total', {count: claims.length})}</p>
    {!query.isLoading && !query.isError && !claims.length && <p className="success">{t('claimsEmpty')}</p>}
    <ul className="cards">{claims.map(claim => <li key={claim.id}><article className="card" aria-labelledby={'c-' + claim.id}>
      <h2 id={'c-' + claim.id}><span className="badge">{claim.profile.type}</span> {claim.profile.name} <span className="muted">@{claim.profile.handle}</span></h2>
      <p className="links"><Link href={'/r/profiles/' + encodeURIComponent(claim.profile.id)}>{t('openRecord')}</Link>
        <a href={webUrl + '/' + locale + '/people/' + claim.profile.handle} target="_blank" rel="noreferrer">{t('openOnSite')}</a>
        {claim.profile.city && <span className="muted">{claim.profile.city.name}</span>}</p>
      <p>{t('claimant')}: <Link href={'/r/users/' + encodeURIComponent(claim.user.id)}>{claim.user.name}</Link> <span className="muted">{claim.user.email} · {t('registered', {date: date(claim.user.createdAt)})}</span></p>
      {claim.message ? <blockquote className="pre">{claim.message}</blockquote> : <p className="muted">{t('noText')}</p>}
      <p className="muted">{t('waitingSince', {date: date(claim.createdAt)})}</p>
      {claim.blocked && <p className="notice">{t('error.' + claim.blocked)}</p>}
      <div className="actions">
        <button type="button" className="button" disabled={!!claim.blocked} onClick={() => decide(claim, true)}>{t('approve')}</button>
        <button type="button" className="button danger" onClick={() => decide(claim, false)}>{t('reject')}</button>
      </div>
    </article></li>)}</ul>
    {ask && <ReasonDialog ask={ask} onClose={() => setAsk(null)}/>}
  </>;
}
