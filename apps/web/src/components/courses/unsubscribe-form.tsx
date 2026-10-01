'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useLocale, useTranslations} from 'next-intl';
// The link in the email only opens this page; the switch is flipped by an explicit POST so that mail scanners cannot unsubscribe anyone.
export function UnsubscribeForm({token}: {token: string}) {
  const t = useTranslations('Courses'), locale = useLocale();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  async function confirm() {
    setState('busy');
    try {
      const response = await fetch('/api/digest/unsubscribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token})});
      setState(response.ok ? 'done' : 'error');
    } catch {setState('error');}
  }
  if (state === 'done') return <div className="unsubscribe-box"><p className="notice" role="status">{t('unsubscribeDone')}</p>
    <p><Link href={'/' + locale + '/settings'}>{t('unsubscribeSettings')}</Link></p></div>;
  return <div className="unsubscribe-box">
    <p>{t('unsubscribeText')}</p>
    <button type="button" className="button" disabled={state === 'busy'} onClick={confirm}>{t(state === 'busy' ? 'unsubscribeWorking' : 'unsubscribeConfirm')}</button>
    {state === 'error' && <p role="alert" className="form-error">{t('unsubscribeError')}</p>}
  </div>;
}
