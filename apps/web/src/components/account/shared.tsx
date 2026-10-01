'use client';
import {useTranslations} from 'next-intl';
import {useState} from 'react';
export type Option = {id: string; name: string};
// Sends JSON and turns any failure into an UPPER_SNAKE error code that the Account or App messages can translate.
export async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = [data.error, data.code, data.message].find(value => typeof value === 'string' && /^[A-Za-z0-9_]+$/.test(value));
    throw new Error(response.status === 429 ? 'TOO_MANY_REQUESTS' : code ? String(code).toUpperCase() : 'GENERIC');
  }
  return data;
}
export function useErrorText() {
  const t = useTranslations('Account'), app = useTranslations('App');
  return (code: string) => t.has('error_' + code) ? t('error_' + code) : app.has('error_' + code) ? app('error_' + code) : app('error_GENERIC');
}
export function useStatus() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const text = useErrorText();
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try {await action();} catch (failure) {setError(failure instanceof Error ? failure.message : 'GENERIC');} finally {setBusy(false);}
  }
  return {busy, error, setError, run, feedback: error ? <p role="alert" className="form-error">{text(error)}</p> : null};
}
