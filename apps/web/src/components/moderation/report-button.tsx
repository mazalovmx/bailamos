'use client';
import {useLocale, useTranslations} from 'next-intl';
import Link from 'next/link';
import {useId, useRef, useState} from 'react';
const reasons = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'FAKE', 'COPYRIGHT', 'OTHER'];
// Native <dialog> gives focus trapping, Escape to close and focus return to the trigger without extra code.
export function ReportButton({targetType, targetId, signedIn}: {targetType: string; targetId: string; signedIn: boolean}) {
  const t = useTranslations('Moderation'), locale = useLocale(), titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  if (!signedIn) return <Link className="report-link" href={'/' + locale + '/login'}>{t('signInToReport')}</Link>;
  async function send(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/reports', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({targetType, targetId, reason: data.reason, comment: data.comment || undefined})});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'GENERIC');
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'GENERIC');
    } finally {setBusy(false);}
  }
  return <>
    <button type="button" className="report-link" aria-haspopup="dialog" onClick={() => {setDone(false); setError(''); dialog.current?.showModal();}}>{t('report')}</button>
    <dialog ref={dialog} aria-labelledby={titleId} className="report-dialog" style={{maxWidth: 440, width: 'calc(100% - 32px)', border: 0, borderRadius: 12, padding: 24}}>
      <h2 id={titleId} style={{marginTop: 0}}>{t('reportTitle')}</h2>
      {done ? <><p role="status">{t('sent')}</p><button type="button" className="button" onClick={() => dialog.current?.close()}>{t('close')}</button></> :
      <form onSubmit={event => {event.preventDefault(); void send(event.currentTarget);}}>
        <p>{t('reportText')}</p>
        <label>{t('reason')}<select name="reason" required defaultValue="">
          <option value="" disabled>{t('chooseReason')}</option>
          {reasons.map(reason => <option key={reason} value={reason}>{t('reason_' + reason)}</option>)}
        </select></label>
        <label>{t('comment')}<textarea name="comment" maxLength={1000} rows={4}/><small>{t('commentHint')}</small></label>
        {error && <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
        <div style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}>
          <button className="button" disabled={busy}>{t(busy ? 'sending' : 'send')}</button>
          <button type="button" className="button secondary" onClick={() => dialog.current?.close()}>{t('cancel')}</button>
        </div>
      </form>}
    </dialog>
  </>;
}
