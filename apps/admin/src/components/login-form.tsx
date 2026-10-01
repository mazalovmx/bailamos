'use client';
import {useState} from 'react';
import {LocaleSwitch, useT} from './i18n';
// Better Auth answers with its own codes; anything that is not explicitly known is shown as wrong credentials.
const known = new Set(['NOT_STAFF', 'EMAIL_NOT_VERIFIED']);
export function LoginForm() {
  const {t} = useT(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <main className="login" id="main">
    <p className="brand">{t('appName')}</p>
    <h1>{t('loginTitle')}</h1>
    <p className="muted">{t('loginText')}</p>
    <form onSubmit={async event => {
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
      {error && <p role="alert" className="error">{t('error.' + error)}</p>}
      <button className="button" disabled={busy}>{t(busy ? 'working' : 'signIn')}</button>
    </form>
    <LocaleSwitch/>
  </main>;
}
