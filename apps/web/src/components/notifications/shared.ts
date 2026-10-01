'use client';
import {useTranslations} from 'next-intl';
// JSON request that turns any failure into an UPPER_SNAKE code for error_<CODE> messages.
export async function call(url: string, method = 'GET', body?: unknown) {
  const response = await fetch(url, {method, ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 429 ? 'TOO_MANY_REQUESTS' : typeof data.error === 'string' && /^[A-Z0-9_]+$/.test(data.error) ? data.error : 'GENERIC');
  return data;
}
export function useNoteError() {
  const t = useTranslations('Notifications'), app = useTranslations('App');
  return (code: string) => t.has('error_' + code) ? t('error_' + code) : app.has('error_' + code) ? app('error_' + code) : app('error_GENERIC');
}
export const CHANGED = 'notifications:changed';
// Tells the header bell that the unread count moved.
export const announce = (unread: number) => window.dispatchEvent(new CustomEvent(CHANGED, {detail: unread}));
