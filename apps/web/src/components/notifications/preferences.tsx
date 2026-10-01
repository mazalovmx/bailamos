'use client';
import {useTranslations} from 'next-intl';
import {useEffect, useState} from 'react';
import type {Preferences} from '../../lib/notifications/center';
import {currentSubscription, disablePush, enablePush, pushSupported} from '../pwa/worker';
import {call, useNoteError} from './shared';
type Device = 'loading' | 'unsupported' | 'ios' | 'unavailable' | 'denied' | 'on' | 'off';
const groups = [['pushGroup', ['pushReminders', 'pushRsvp', 'pushChat']], ['emailGroup', ['emailEvents', 'emailDigest']]] as const;
export function NotificationPreferences({initial, pushConfigured}: {initial: Preferences; pushConfigured: boolean}) {
  const t = useTranslations('Notifications'), errorText = useNoteError();
  const [values, setValues] = useState(initial), [device, setDevice] = useState<Device>('loading');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      if (!pushSupported()) {
        const agent = navigator.userAgent, apple = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
        return setDevice(apple ? 'ios' : 'unsupported');
      }
      if (!pushConfigured) return setDevice('unavailable');
      if (Notification.permission === 'denied') return setDevice('denied');
      const subscription = Notification.permission === 'granted' ? await currentSubscription() : null;
      if (!subscription) return setDevice('off');
      setDevice('on');
      // Keeps the stored subscription attached to whoever is signed in on this browser now.
      void fetch('/api/push/subscriptions', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(subscription.toJSON())}).catch(() => undefined);
    })().catch(() => setDevice('unsupported'));
  }, [pushConfigured]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setSaved(false);
    try {await action();} catch (failure) {setError(failure instanceof Error && /^[A-Z0-9_]+$/.test(failure.message) ? failure.message : 'PUSH_FAILED');} finally {setBusy(false);}
  }
  const toggle = (key: keyof Preferences, checked: boolean) => run(async () => {
    const before = values;
    setValues({...values, [key]: checked});
    try {setValues(await call('/api/notifications/preferences', 'PUT', {[key]: checked})); setSaved(true);}
    catch (failure) {setValues(before); throw failure;}
  });
  const switchDevice = (on: boolean) => run(async () => {
    try {if (on) await enablePush(); else await disablePush(); setDevice(on ? 'on' : 'off');}
    catch (failure) {if (failure instanceof Error && failure.message === 'PUSH_DENIED' && Notification.permission === 'denied') {setDevice('denied'); return;} throw failure;}
  });
  const note: Partial<Record<Device, string>> = {unsupported: t('deviceUnsupported'), ios: t('deviceIosHint'), unavailable: t('deviceUnavailable'),
    denied: t('deviceDenied'), on: t('deviceOn'), off: t('deviceOff')};
  return <div className="note-prefs">
    {groups.map(([legend, keys]) => <fieldset key={legend} className="choice-group"><legend>{t(legend)}</legend>
      {keys.map(key => <label key={key} className="checkbox"><input type="checkbox" checked={values[key]} disabled={busy} onChange={event => toggle(key, event.target.checked)}/>
        <span>{t('pref_' + key)}</span></label>)}
    </fieldset>)}
    <div className="note-device" role="group" aria-labelledby="note-device-title"><h3 id="note-device-title">{t('deviceTitle')}</h3>
      <p id="note-device-state">{note[device] || '…'}</p>
      {(device === 'on' || device === 'off') && <button type="button" className="button secondary" disabled={busy} aria-describedby="note-device-state"
        onClick={() => switchDevice(device === 'off')}>{t(device === 'off' ? 'deviceEnable' : 'deviceDisable')}</button>}
    </div>
    <p className="note-status" role="status">{saved && !error ? t('prefsSaved') : ''}</p>
    {error && <p role="alert" className="form-error">{errorText(error)}</p>}
  </div>;
}
