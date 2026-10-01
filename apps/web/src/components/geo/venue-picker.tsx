'use client';
import {useEffect, useId, useState} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import '../../app/styles/geo.css';
type Venue = {id: string; name: string; address: string};
// Chooses one of the city's venues for a form. The value travels in a hidden input called `name`; empty means "no venue".
export function VenuePicker({name, cityId, initialVenueId}: {name: string; cityId: string; initialVenueId?: string}) {
  const t = useTranslations('Geo'), locale = useLocale(), id = useId();
  const [venues, setVenues] = useState<Venue[]>([]), [value, setValue] = useState(initialVenueId || '');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle'), [version, setVersion] = useState(0);
  useEffect(() => {
    if (!cityId) { setVenues([]); setValue(''); return; }
    const controller = new AbortController();
    setState('loading');
    fetch('/api/venues?cityId=' + encodeURIComponent(cityId), {signal: controller.signal})
      .then(response => response.ok ? response.json() : Promise.reject(new Error('GENERIC')))
      .then((data: {venues: Venue[]}) => {
        setVenues(data.venues);
        // A venue of another city is dropped when the city changes.
        setValue(current => data.venues.some(venue => venue.id === current) ? current : '');
        setState('idle');
      }).catch(error => { if (error?.name !== 'AbortError') setState('error'); });
    return () => controller.abort();
  }, [cityId, version]);
  return <div className="geo-venue-picker">
    <input type="hidden" name={name} value={value}/>
    <label htmlFor={id}>{t('venue')}</label>
    <select id={id} value={value} disabled={!cityId || state === 'loading'} aria-describedby={id + '-hint'} onChange={event => setValue(event.target.value)}>
      <option value="">{t(!cityId ? 'venueChooseCity' : state === 'loading' ? 'venueLoading' : 'venueNone')}</option>
      {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name} — {venue.address}</option>)}
    </select>
    <div className="geo-inline" id={id + '-hint'}>
      {state === 'error' && <span role="alert">{t('venueLoadError')}</span>}
      {cityId && state === 'idle' && !venues.length && <span>{t('venueEmpty')}</span>}
      {cityId && <a href={'/' + locale + '/venues/new?cityId=' + encodeURIComponent(cityId)} target="_blank" rel="noopener">{t('venueAdd')} <span className="sr-only">{t('opensNewTab')}</span><span aria-hidden="true">↗</span></a>}
      {cityId && <button type="button" className="geo-link-button" onClick={() => setVersion(version + 1)}>{t('venueRefresh')}</button>}
    </div>
  </div>;
}
