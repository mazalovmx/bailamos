'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {api, errorCode} from '../lib/data-provider';
import {useT} from './i18n';
import {usePanel} from './panel';

type Added = {email: string; loginUrl: string};
function AddAdminDialog({onClose, onAdded}: {onClose: () => void; onAdded: () => void}) {
  const {t, has} = useT(), dialog = useRef<HTMLDialogElement>(null), titleId = useId(), helpId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {dialog.current?.showModal();}, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose} onCancel={event => {if (busy) event.preventDefault();}}>
    <form onSubmit={async event => {
      event.preventDefault();
      const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
      setBusy(true); setError('');
      try {
        const result = await api<Added>('/api/users', {method: 'POST', body: {email}});
        setAdded(result); onAdded();
      } catch (failure) {
        const code = errorCode(failure); setError(has('error.' + code) ? t('error.' + code) : t('error.GENERIC'));
      } finally {setBusy(false);}
    }}>
      <h2 id={titleId}>{t('addAdminTitle')}</h2>
      {added ? <>
        <p className="success" role="status">{t('adminAdded', {email: added.email})}</p>
        <p>{t('adminAddedHelp')}</p>
        <p className="pre"><a href={added.loginUrl}>{added.loginUrl}</a></p>
        <div className="actions">
          <button type="button" className="button ghost" onClick={async () => {
            try {await navigator.clipboard.writeText(added.loginUrl); setCopied(true); setError('');}
            catch {setError(t('copyLinkFailed'));}
          }}>{t(copied ? 'linkCopied' : 'copyLoginLink')}</button>
          <button type="button" className="button" onClick={() => dialog.current?.close()}>{t('close')}</button>
        </div>
      </> : <>
        <p id={helpId}>{t('addAdminHelp')}</p>
        <label>{t('email')}<input name="email" type="email" required maxLength={254} autoComplete="email" autoFocus aria-describedby={helpId} disabled={busy}/></label>
        <div className="actions">
          <button className="button" disabled={busy}>{busy ? t('working') : t('addUser')}</button>
          <button type="button" className="button ghost" disabled={busy} onClick={() => dialog.current?.close()}>{t('cancel')}</button>
        </div>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </dialog>;
}

export function AddAdmin({onAdded}: {onAdded: () => void}) {
  const {user} = usePanel(), {t} = useT(), [open, setOpen] = useState(false);
  if (user.role !== 'OWNER') return null;
  return <>
    <button type="button" className="button" onClick={() => setOpen(true)}>{t('addUser')}</button>
    {open && <AddAdminDialog onClose={() => setOpen(false)} onAdded={onAdded}/>}
  </>;
}
