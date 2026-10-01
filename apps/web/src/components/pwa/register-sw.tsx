'use client';
import {usePathname} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {useEffect, useRef, useState} from 'react';
import {currentSubscription, registerWorker, rememberSession, tellWorker, workerSupported} from './worker';
import '../../app/styles/notifications.css';
// Registers /sw.js (an external file, so it works under a CSP without inline scripts), offers a reload when a new
// version is waiting, reports viewed pages for the offline cache and cleans up after a sign-out.
export function RegisterSw({signedIn}: {signedIn: boolean}) {
  const t = useTranslations('Notifications'), path = usePathname();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null), reloading = useRef(false), first = useRef(true);
  useEffect(() => {
    if (!workerSupported()) return;
    let cancelled = false;
    const onControllerChange = () => {if (reloading.current) window.location.reload();};
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    registerWorker().then(registration => {
      if (cancelled) return;
      // Only an update counts: the very first worker takes over silently.
      const offer = (worker: ServiceWorker | null) => {if (worker && navigator.serviceWorker.controller) setWaiting(worker);};
      offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {if (worker.state === 'installed') offer(worker);});
      });
    }).catch(() => undefined);
    return () => {cancelled = true; navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);};
  }, []);
  useEffect(() => {
    // Signed out (here or by an expired session): this browser must stop receiving the previous account's pushes.
    if (rememberSession(signedIn) && !signedIn) {
      void tellWorker({type: 'SIGNED_OUT'}).catch(() => undefined);
      void currentSubscription().then(subscription => subscription?.unsubscribe()).catch(() => undefined);
    }
  }, [signedIn]);
  useEffect(() => {
    // A full page load was already seen by a controlling worker; in-app navigation and the first visit are reported.
    const seen = first.current && workerSupported() && !!navigator.serviceWorker.controller;
    first.current = false;
    if (!seen) void tellWorker({type: 'VIEWED', url: window.location.href}).catch(() => undefined);
  }, [path]);
  if (!waiting) return null;
  return <div className="pwa-toast" role="status"><span>{t('updateReady')}</span>
    <button type="button" className="button" onClick={() => {reloading.current = true; waiting.postMessage({type: 'SKIP_WAITING'});}}>{t('updateReload')}</button></div>;
}
