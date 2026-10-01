'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
async function send(method: 'PUT' | 'DELETE', url: string, body: unknown) {
  const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GENERIC');
  return data;
}
const code = (failure: unknown) => failure instanceof Error ? failure.message : 'GENERIC';
function Failure({error}: {error: string}) {
  const t = useTranslations('Matching');
  return error ? <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p> : null;
}
// Expresses or withdraws interest. The other person is not told unless the interest is mutual.
export function InterestButton({profileId, styleId, name, initial}: {profileId: string; styleId?: string; name: string; initial: boolean}) {
  const t = useTranslations('Matching'), locale = useLocale();
  const [interested, setInterested] = useState(initial), [matched, setMatched] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function toggle() {
    setBusy(true); setError('');
    try {
      const data = await send(interested ? 'DELETE' : 'PUT', '/api/matching/interest', interested ? {profileId} : {profileId, ...(styleId ? {styleId} : {})});
      setInterested(!!data.interested); setMatched(!!data.matched);
    } catch (failure) {setError(code(failure));} finally {setBusy(false);}
  }
  return <div className="partner-action">
    <button type="button" className={interested ? 'button' : 'button secondary'} aria-pressed={interested} disabled={busy} onClick={toggle}
      aria-label={t('interestIn', {name})}>
      <span aria-hidden="true">{interested ? '✓ ' : ''}</span>{t(interested ? 'interested' : 'interest')}</button>
    <p role="status" className="field-note">{matched ? <>{t('matchedNow', {name})} <Link href={'/' + locale + '/partners/matches'}>{t('openMatches')}</Link></>
      : interested ? t('interestPrivate') : ''}</p>
    <Failure error={error}/>
  </div>;
}
// Withdraws an interest from the "sent" and "matches" lists.
export function WithdrawButton({profileId, name}: {profileId: string; name: string}) {
  const t = useTranslations('Matching'), router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function withdraw() {
    setBusy(true); setError('');
    try {await send('DELETE', '/api/matching/interest', {profileId}); router.refresh();}
    catch (failure) {setError(code(failure)); setBusy(false);}
  }
  return <div className="partner-action">
    <button type="button" className="button secondary" disabled={busy} onClick={withdraw} aria-label={t('withdrawFrom', {name})}>{t('withdraw')}</button>
    <Failure error={error}/>
  </div>;
}
// Two-step block: the first press asks, the second confirms. Nothing tells the blocked person.
export function BlockButton({profileId, name}: {profileId: string; name: string}) {
  const t = useTranslations('Matching'), router = useRouter();
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  async function block() {
    setBusy(true); setError('');
    try {await send('PUT', '/api/matching/block', {profileId}); setDone(true); router.refresh();}
    catch (failure) {setError(code(failure));} finally {setBusy(false);}
  }
  if (done) return <p role="status" className="field-note">{t('blocked', {name})}</p>;
  return <div className="partner-block">
    {asking ? <div role="group" aria-label={t('blockPerson', {name})} className="partner-confirm">
      <p>{t('blockConfirm', {name})}</p>
      <button type="button" className="button danger" disabled={busy} onClick={block}>{t(busy ? 'working' : 'blockYes')}</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => setAsking(false)}>{t('cancel')}</button>
    </div> : <button type="button" className="report-link" onClick={() => setAsking(true)} aria-label={t('blockPerson', {name})}>{t('block')}</button>}
    <Failure error={error}/>
  </div>;
}
