'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import Link from 'next/link';
import {send, useErrorText, useStatus} from './shared';
import '../../app/styles/account.css';
type Mode = 'login' | 'register' | 'forgot' | 'reset';
export function AuthForm({mode, token, google = false, initialError}: {mode: Mode; token?: string; google?: boolean; initialError?: string}) {
  const t = useTranslations('Account'), app = useTranslations('App'), locale = useLocale(), router = useRouter(), s = useStatus(), errorText = useErrorText();
  const [done, setDone] = useState<'' | 'register' | 'forgot' | 'reset' | 'magic'>('');
  const [magic, setMagic] = useState(false);
  const home = '/' + locale;
  const title = {login: 'loginTitle', register: 'registerTitle', forgot: 'forgotTitle', reset: 'resetTitle'}[mode];
  const doneText = {register: app('checkEmail'), forgot: app('resetSent'), reset: app('passwordSaved'), magic: t('magicSent')};
  const usePassword = mode === 'register' || mode === 'reset' || (mode === 'login' && !magic);
  async function submit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>, origin = window.location.origin;
    if (mode === 'register') await send('/api/auth/sign-up/email', 'POST', {name: data.name, email: data.email, password: data.password,
      ageConfirmed: data.consent === 'on', locale, callbackURL: origin + home + '/onboarding'});
    if (mode === 'login' && magic) {
      await send('/api/auth/sign-in/magic-link', 'POST', {email: data.email, callbackURL: origin + home + '/profile', errorCallbackURL: origin + home + '/login'});
      setDone('magic'); return;
    }
    if (mode === 'login') {
      await send('/api/auth/sign-in/email', 'POST', {email: data.email, password: data.password});
      router.push(home + '/profile'); router.refresh(); return;
    }
    if (mode === 'forgot') await send('/api/auth/request-password-reset', 'POST', {email: data.email, redirectTo: origin + home + '/reset-password'});
    if (mode === 'reset') await send('/api/auth/reset-password', 'POST', {newPassword: data.password, token});
    setDone(mode);
  }
  async function withGoogle() {
    const origin = window.location.origin;
    const result = await send('/api/auth/sign-in/social', 'POST', {provider: 'google', callbackURL: origin + home + '/profile',
      newUserCallbackURL: origin + home + '/onboarding', errorCallbackURL: origin + home + '/login'});
    if (typeof result.url === 'string') window.location.assign(result.url);
  }
  return <section className="form-page narrow"><p className="eyebrow">DANCE COMMUNITY</p><h1>{app(title)}</h1>
    {mode === 'register' && <p className="intro">{app('registerText')}</p>}
    {mode === 'login' && <p className="intro">{app('loginText')}</p>}
    {initialError && !s.error && !done && <p role="alert" className="form-error">{errorText(initialError)}</p>}
    {done ? <p className="notice" role="status">{doneText[done]}</p> :
    <form onSubmit={e => {e.preventDefault(); const form = e.currentTarget; s.run(() => submit(form));}}>
      {mode === 'login' && <fieldset className="account-switch"><legend>{t('signInMethod')}</legend>
        <label><input type="radio" name="method" checked={!magic} onChange={() => setMagic(false)}/>{t('methodPassword')}</label>
        <label><input type="radio" name="method" checked={magic} onChange={() => setMagic(true)}/>{t('methodMagic')}</label>
      </fieldset>}
      {mode === 'register' && <label>{app('name')}<input name="name" required minLength={2} maxLength={80} autoComplete="name"/></label>}
      {mode !== 'reset' && <label>{app('email')}<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>}
      {usePassword && <label>{app('password')}<input name="password" type="password" required minLength={mode === 'login' ? 1 : 10} maxLength={128}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'login' ? undefined : 'password-hint'}/>
        {mode !== 'login' && <small id="password-hint">{app('passwordHint')}</small>}</label>}
      {mode === 'login' && magic && <p className="field-note">{t('magicHint')}</p>}
      {mode === 'register' && <><label className="checkbox"><input name="consent" type="checkbox" required/>
        <span>{t('consent')}</span></label>
        <p className="field-note"><Link href={home + '/privacy'}>{t('readPolicy')}</Link></p></>}
      {s.feedback}
      <button className="button" disabled={s.busy}>{s.busy ? app('working') : mode === 'login' ? (magic ? t('sendMagic') : app('signIn')) :
        mode === 'register' ? app('signUp') : mode === 'forgot' ? app('sendLink') : app('savePassword')}</button>
      {google && (mode === 'login' || mode === 'register') && <><p className="account-or" aria-hidden="true">{t('or')}</p>
        <button type="button" className="button secondary" disabled={s.busy} onClick={() => s.run(withGoogle)}>{t('google')}</button>
        {mode === 'register' && <p className="field-note">{t('googleConsentNote')}</p>}</>}
    </form>}
    <div className="form-links"><Link href={home + (mode === 'login' ? '/register' : '/login')}>{app(mode === 'login' ? 'noAccount' : 'haveAccount')} {app(mode === 'login' ? 'signUp' : 'signIn')}</Link>
      {mode === 'login' && <Link href={home + '/forgot-password'}>{app('forgot')}</Link>}
      <Link href={home + '/privacy'}>{t('privacyLink')}</Link></div>
  </section>;
}
