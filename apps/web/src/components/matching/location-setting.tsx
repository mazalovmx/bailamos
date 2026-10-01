'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
// Optional position for radius search. The browser is asked only after an explicit press, the point is rounded to about a
// kilometre before it leaves the device, and the server snaps it to a coarse grid before storing it. It is never displayed.
export function LocationSetting({located}: {located: boolean}) {
  const t = useTranslations('Matching'), router = useRouter();
  const [saved, setSaved] = useState(located), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  async function put(body: unknown) {
    const response = await fetch('/api/profile/location', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'GENERIC');
    setSaved(!!data.located); setStatus(t(data.located ? 'locationSaved' : 'locationCleared')); router.refresh();
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setStatus('');
    try {await action();} catch (failure) {setError(failure instanceof Error ? failure.message : 'GENERIC');} finally {setBusy(false);}
  }
  const locate = () => run(async () => {
    if (!navigator.geolocation) throw new Error('GEOLOCATION_UNAVAILABLE');
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve,
      failure => reject(new Error(failure.code === failure.PERMISSION_DENIED ? 'GEOLOCATION_DENIED' : 'GEOLOCATION_UNAVAILABLE')),
      {enableHighAccuracy: false, timeout: 10000, maximumAge: 600000}));
    await put({lat: Number(position.coords.latitude.toFixed(2)), lng: Number(position.coords.longitude.toFixed(2))});
  });
  return <section className="partner-location" aria-labelledby="partner-location-title">
    <h2 id="partner-location-title">{t('locationTitle')}</h2>
    <p>{t('locationText')}</p>
    <p className="field-note">{t(saved ? 'locationOn' : 'locationOff')}</p>
    <div className="partner-buttons">
      <button type="button" className="button secondary" disabled={busy} onClick={locate}>{t(busy ? 'working' : saved ? 'locationUpdate' : 'locationUse')}</button>
      {saved && <button type="button" className="button secondary" disabled={busy} onClick={() => run(() => put(null))}>{t('locationClear')}</button>}
    </div>
    <p role="status" className="field-note">{status}</p>
    {error && <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
  </section>;
}
