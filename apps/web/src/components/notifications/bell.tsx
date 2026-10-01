'use client';
import Link from 'next/link';
import {useLocale, useTranslations} from 'next-intl';
import {useEffect, useState} from 'react';
import {CHANGED} from './shared';
import '../../app/styles/notifications.css';
const POLL_MS = 60000;
// Header link to the notification centre with an unread badge. Polls once a minute, only while the tab is visible,
// and refreshes at once when a push arrives or the centre marks something as read.
export function NotificationBell({initialCount = 0}: {initialCount?: number}) {
  const t = useTranslations('Notifications'), locale = useLocale();
  const [count, setCount] = useState(initialCount);
  useEffect(() => {
    let timer: number | undefined, stopped = false;
    async function refresh() {
      try {
        const response = await fetch('/api/notifications/unread-count', {cache: 'no-store'});
        // Signed out in another tab: stop asking.
        if (response.status === 401) {stopped = true; window.clearInterval(timer); return;}
        const data = await response.json();
        if (response.ok && typeof data.count === 'number') setCount(data.count);
      } catch {/* offline: keep the last known number */}
    }
    const start = () => {window.clearInterval(timer); if (!stopped && !document.hidden) timer = window.setInterval(refresh, POLL_MS);};
    const onVisibility = () => {if (document.hidden) window.clearInterval(timer); else if (!stopped) {void refresh(); start();}};
    const onChanged = (event: Event) => {const value = (event as CustomEvent).detail; if (typeof value === 'number') setCount(value); else void refresh();};
    const onMessage = (event: MessageEvent) => {if (event.data?.type === 'PUSH_RECEIVED') void refresh();};
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(CHANGED, onChanged);
    worker?.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(CHANGED, onChanged);
      worker?.removeEventListener('message', onMessage);
    };
  }, []);
  useEffect(() => {
    // Home-screen icon badge where the platform has one.
    const badge = navigator as Navigator & {setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void>};
    (count ? badge.setAppBadge?.(count) : badge.clearAppBadge?.())?.catch(() => undefined);
  }, [count]);
  return <Link className="note-bell" href={'/' + locale + '/notifications'} aria-label={count ? t('bellUnread', {count}) : t('bellLabel')}>
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>
    {count > 0 && <span className="note-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
  </Link>;
}
