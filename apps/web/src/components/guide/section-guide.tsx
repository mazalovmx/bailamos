'use client';
import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useTranslations} from 'next-intl';
import 'driver.js/dist/driver.css';

export function SectionGuide({id, userId, steps}: {id: string; userId?: string; steps: string[]}) {
  const t = useTranslations('Guide'), instance = useRef<import('driver.js').Driver | null>(null);
  const storageKey = `dance-guide:${userId || 'visitor'}:${id}`;
  const stepList = useMemo(() => steps.map(step => ({element: `[data-guide="${id}-${step}"]`, popover: {title: t(`${id}.${step}Title`), description: t(`${id}.${step}Text`)}})), [id, steps, t]);
  const options = useMemo(() => ({showProgress: true, progressText: t.raw('progress') as string,
    nextBtnText: t('next'), prevBtnText: t('previous'), doneBtnText: t('done'),
    allowKeyboardControl: true, allowClose: true, smoothScroll: true, skipMissingElement: true,
    popoverClass: 'dance-guide-popover',
    onDestroyed: () => {instance.current = null; try {localStorage.setItem(storageKey, 'done');} catch { /* Storage can be disabled. */ }}
  }), [storageKey, t]);
  const launch = useCallback(async () => {
    const {driver} = await import('driver.js');
    const tour = instance.current || driver(options);
    instance.current = tour;
    tour.setConfig(options); tour.setSteps(stepList); tour.drive();
  }, [options, stepList]);

  useEffect(() => {
    let cancelled = false;
    try {if (localStorage.getItem(storageKey)) return;} catch { /* Treat unavailable storage as a first visit. */ }
    void import('driver.js').then(({driver}) => {
      if (cancelled) return;
      const tour = instance.current || driver(options);
      instance.current = tour; tour.setSteps(stepList); tour.drive();
    });
    return () => {cancelled = true; instance.current?.destroy(); instance.current = null;};
  }, [options, stepList, storageKey]);

  return <button type="button" className="guide-replay" onClick={() => void launch()}>{t('replay')}</button>;
}
