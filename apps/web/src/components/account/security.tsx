'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {send, useStatus} from './shared';
// Asks for a new sign-in email. Nothing changes until the link mailed to the new address is opened.
export function ChangeEmail({hasPassword}: {hasPassword: boolean}) {
  const t = useTranslations('Account'), app = useTranslations('App'), s = useStatus();
  const [open, setOpen] = useState(false), [sentTo, setSentTo] = useState('');
  if (sentTo) return <p className="notice" role="status">{t('emailChangeSent', {email: sentTo})}</p>;
  if (!open) return <button type="button" className="button secondary" onClick={() => setOpen(true)}>{t('emailChangeStart')}</button>;
  return <form className="delete-form" onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget);
    s.run(async () => {
      const newEmail = String(data.get('newEmail') || '').trim();
      await send('/api/account/email', 'POST', hasPassword ? {newEmail, password: data.get('password')} : {newEmail});
      setSentTo(newEmail);
    });}}>
    <label>{t('emailNew')}<input name="newEmail" type="email" required maxLength={254} autoComplete="email" aria-describedby="email-change-hint"/>
      <small id="email-change-hint">{t('emailChangeHint')}</small></label>
    {hasPassword ? <label>{t('currentPassword')}<input name="password" type="password" required maxLength={128} autoComplete="current-password"/></label> :
      <p className="field-note">{t('deleteFreshHint')}</p>}
    {s.feedback}
    <div className="account-actions"><button className="button" disabled={s.busy}>{s.busy ? app('working') : t('emailChangeSubmit')}</button>
      <button type="button" className="button secondary" disabled={s.busy} onClick={() => {setOpen(false); s.setError('');}}>{t('cancel')}</button></div>
  </form>;
}
// Changes the password in place and signs every other device out.
export function ChangePassword() {
  const t = useTranslations('Account'), app = useTranslations('App'), router = useRouter(), s = useStatus();
  const [open, setOpen] = useState(false), [done, setDone] = useState(false);
  if (done) return <p className="notice" role="status">{t('passwordChanged')}</p>;
  if (!open) return <button type="button" className="button secondary" onClick={() => setOpen(true)}>{t('passwordChangeStart')}</button>;
  return <form className="delete-form" onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget);
    s.run(async () => {
      await send('/api/auth/change-password', 'POST', {currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword'), revokeOtherSessions: true});
      setDone(true); router.refresh();
    });}}>
    <label>{t('currentPassword')}<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password"/></label>
    <label>{t('newPassword')}<input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" aria-describedby="new-password-hint"/>
      <small id="new-password-hint">{t('newPasswordHint')}</small></label>
    {s.feedback}
    <div className="account-actions"><button className="button" disabled={s.busy}>{s.busy ? app('working') : t('passwordChangeSubmit')}</button>
      <button type="button" className="button secondary" disabled={s.busy} onClick={() => {setOpen(false); s.setError('');}}>{t('cancel')}</button></div>
  </form>;
}
// Connects Google through the provider round trip, or disconnects it while a password remains.
export function GoogleLink({connected, available, canUnlink}: {connected: boolean; available: boolean; canUnlink: boolean}) {
  const t = useTranslations('Account'), app = useTranslations('App'), locale = useLocale(), router = useRouter(), s = useStatus();
  if (!connected && !available) return null;
  const link = () => s.run(async () => {
    const settings = window.location.origin + '/' + locale + '/settings';
    const result = await send('/api/auth/link-social', 'POST', {provider: 'google', callbackURL: settings, errorCallbackURL: settings});
    if (typeof result.url !== 'string') throw new Error('GENERIC');
    window.location.assign(result.url);
  });
  const unlink = () => s.run(async () => {await send('/api/account/google', 'DELETE', {}); router.refresh();});
  return <div>
    {connected && !canUnlink ? <p className="field-note">{t('googleUnlinkNeedsPassword')}</p> :
      <button type="button" className="button secondary" disabled={s.busy} onClick={connected ? unlink : link}>
        {s.busy ? app('working') : t(connected ? 'googleUnlink' : 'googleLink')}</button>}
    {!connected && <p className="field-note">{t('googleLinkHint')}</p>}
    {s.feedback}
  </div>;
}
// Ends every session except the one in this browser.
export function SignOutOthers({others}: {others: number}) {
  const t = useTranslations('Account'), app = useTranslations('App'), router = useRouter(), s = useStatus();
  const [done, setDone] = useState(false);
  if (done) return <p className="notice" role="status">{t('sessionsRevoked')}</p>;
  if (!others) return <p className="field-note">{t('sessionsOnlyThis')}</p>;
  return <div><button type="button" className="button secondary" disabled={s.busy} onClick={() => s.run(async () => {
    await send('/api/auth/revoke-other-sessions', 'POST', {});
    setDone(true); router.refresh();
  })}>{s.busy ? app('working') : t('sessionsRevoke')}</button>{s.feedback}</div>;
}
