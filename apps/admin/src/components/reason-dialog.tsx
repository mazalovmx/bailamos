'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {errorCode} from '../lib/data-provider';
import {useT} from './i18n';
export type Ask = {title: string; text?: string; confirm: string; danger?: boolean; reason: 'required' | 'optional' | 'none';
  run: (reason: string) => Promise<void>};
// Confirmation for every moderation action. Native <dialog>: focus is trapped, Escape closes, focus returns to the trigger.
export function ReasonDialog({ask, onClose}: {ask: Ask; onClose: () => void}) {
  const {t, has} = useT(), ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onClose={onClose}>
    <form onSubmit={async event => {
      event.preventDefault();
      const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
      setBusy(true); setError('');
      try {await ask.run(reason); ref.current?.close();}
      catch (failure) {const code = errorCode(failure); setError(has('error.' + code) ? t('error.' + code) : t('error.GENERIC'));}
      finally {setBusy(false);}
    }}>
      <h2 id={titleId}>{ask.title}</h2>
      {ask.text && <p>{ask.text}</p>}
      {ask.reason !== 'none' && <label>{t(ask.reason === 'required' ? 'reasonRequired' : 'reasonOptional')}
        <textarea name="reason" rows={3} maxLength={1000} required={ask.reason === 'required'} autoFocus/></label>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions">
        <button className={ask.danger ? 'button danger' : 'button'} disabled={busy} autoFocus={ask.reason === 'none'}>{busy ? t('working') : ask.confirm}</button>
        <button type="button" className="button ghost" onClick={() => ref.current?.close()}>{t('cancel')}</button>
      </div>
    </form>
  </dialog>;
}
