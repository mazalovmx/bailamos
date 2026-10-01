'use client';
import {useTranslations} from 'next-intl';
import {useEffect, useState} from 'react';
import '../../app/styles/notifications.css';
type InstallEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};
const KEY = 'dc-install-dismissed', QUIET_MS = 90 * 24 * 3600 * 1000;
const dismissedRecently = () => {try {return Date.now() - Number(localStorage.getItem(KEY) || 0) < QUIET_MS;} catch {return false;}};
// Android and desktop browsers hand over an install event; iOS Safari has none, so it gets a one-line instruction.
export function InstallPrompt() {
  const t = useTranslations('Notifications');
  const [event, setEvent] = useState<InstallEvent | null>(null), [ios, setIos] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true;
    if (standalone || dismissedRecently()) return;
    const agent = navigator.userAgent, apple = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
    if (apple && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(agent)) setIos(true);
    const onPrompt = (incoming: Event) => {incoming.preventDefault(); setEvent(incoming as InstallEvent);};
    const onInstalled = () => {setEvent(null); setIos(false);};
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled);};
  }, []);
  if (!event && !ios) return null;
  const close = () => {try {localStorage.setItem(KEY, String(Date.now()));} catch {/* private mode */} setEvent(null); setIos(false);};
  return <aside className="pwa-install" aria-labelledby="pwa-install-title">
    <div><h2 id="pwa-install-title">{t('installTitle')}</h2><p>{event ? t('installText') : t('installIos')}</p></div>
    <div className="pwa-install-actions">
      {event && <button type="button" className="button" onClick={async () => {
        await event.prompt().catch(() => undefined);
        const choice = await event.userChoice.catch(() => null);
        if (choice?.outcome === 'accepted') {setEvent(null); setIos(false);} else close();
      }}>{t('installButton')}</button>}
      <button type="button" className="button secondary" onClick={close}>{t('installDismiss')}</button>
    </div>
  </aside>;
}
