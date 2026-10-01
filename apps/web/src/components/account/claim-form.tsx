'use client';
import {useTranslations} from 'next-intl';
import {useState} from 'react';
import {send, useStatus} from './shared';
export function ClaimForm({handle}: {handle: string}) {
  const t = useTranslations('Account'), app = useTranslations('App'), s = useStatus();
  const [done, setDone] = useState(false);
  if (done) return <p className="notice" role="status">{t('claimSent')}</p>;
  return <form className="claim-form" onSubmit={e => {e.preventDefault(); const message = String(new FormData(e.currentTarget).get('message') || '');
    s.run(async () => {await send('/api/claims', 'POST', {handle, message}); setDone(true);});}}>
    <label>{t('claimMessage')}<textarea name="message" required minLength={10} maxLength={1000} rows={4} aria-describedby="claim-hint"/>
      <small id="claim-hint">{t('claimHint')}</small></label>
    {s.feedback}
    <button className="button" disabled={s.busy}>{s.busy ? app('working') : t('claimSubmit')}</button>
  </form>;
}
