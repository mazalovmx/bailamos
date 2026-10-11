'use client';
import {useState} from 'react';
import {LocaleSwitch, useT} from './i18n';
// Better Auth answers with its own codes; anything that is not explicitly known is shown as wrong credentials.
const known = new Set(['NOT_STAFF', 'EMAIL_NOT_VERIFIED']);
export function LoginForm({googleEnabled = false, emailEnabled = true, oauthError = false}: {googleEnabled?: boolean; emailEnabled?: boolean; oauthError?: boolean}) {
  const {t} = useT(), [busy, setBusy] = useState(false), [error, setError] = useState(oauthError ? 'NOT_STAFF' : '');
  return <main className="login" id="main">
    <p className="brand">{t('appName')}</p>
    <h1>{t('loginTitle')}</h1>
    <p className="muted">{t('loginText')}</p>
    {googleEnabled && <button className="button" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const response = await fetch('/api/auth/sign-in/social', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({provider: 'google', callbackURL: '/', errorCallbackURL: '/login', disableRedirect: true})});
        const body = await response.json();
        if (!response.ok || typeof body.url !== 'string') throw new Error('SOCIAL_SIGN_IN_FAILED');
        const url = new URL(body.url);
        if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('INVALID_PROVIDER_URL');
        window.location.assign(url.href);
      } catch {setError('GENERIC'); setBusy(false);}
    }}>{t(busy ? 'working' : 'signInGoogle')}</button>}
    {emailEnabled && <form onSubmit={async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      setBusy(true); setError('');
      try {
        const response = await fetch('/api/auth/sign-in/email', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email: data.email, password: data.password})});
        if (response.ok) {window.location.assign('/'); return;}
        const body = await response.json().catch(() => ({}));
        setError(response.status === 429 ? 'RATE_LIMITED' : known.has(body.code) ? body.code : 'INVALID_CREDENTIALS');
      } catch {setError('GENERIC');} finally {setBusy(false);}
    }}>
      <label>{t('email')}<input name="email" type="email" required maxLength={254} autoComplete="username"/></label>
      <label>{t('password')}<input name="password" type="password" required maxLength={128} autoComplete="current-password"/></label>
      <button className="button" disabled={busy}>{t(busy ? 'working' : 'signIn')}</button>
    </form>}
    {error && <p role="alert" className="error">{t('error.' + error)}</p>}
    <LocaleSwitch/>
  </main>;
}
