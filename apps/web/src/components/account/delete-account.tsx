'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useState} from 'react';
import {send, useStatus} from './shared';
export function DeleteAccount({hasPassword}: {hasPassword: boolean}) {
  const t = useTranslations('Account'), app = useTranslations('App'), locale = useLocale(), s = useStatus();
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="button secondary danger" onClick={() => setOpen(true)}>{t('deleteStart')}</button>;
  return <form className="delete-form" onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget);
    s.run(async () => {
      await send('/api/account', 'DELETE', hasPassword ? {password: data.get('password')} : {confirmEmail: data.get('confirmEmail')});
      window.location.assign('/' + locale);
    });}}>
    <p className="form-error" role="note">{t('deleteWarning')}</p>
    {hasPassword ? <label>{t('deletePassword')}<input name="password" type="password" required maxLength={128} autoComplete="current-password"/></label> :
      <label>{t('deleteEmail')}<input name="confirmEmail" type="email" required maxLength={254} autoComplete="off" aria-describedby="delete-hint"/>
        <small id="delete-hint">{t('deleteFreshHint')}</small></label>}
    {s.feedback}
    <div className="account-actions"><button className="button danger" disabled={s.busy}>{s.busy ? app('working') : t('deleteConfirm')}</button>
      <button type="button" className="button secondary" disabled={s.busy} onClick={() => setOpen(false)}>{t('cancel')}</button></div>
  </form>;
}
