'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {VenuePicker} from './venue-picker';
import {LocationMap} from './location-map';
import '../../app/styles/geo.css';
type City = {id: string; name: string; lat?: number; lng?: number};
// Where an event takes place: one of the city's venues, or an exact point of its own (a park, a square) when there is none.
// Submits "venueId" and "pin" (JSON {lat,lng} or empty); the server accepts one or the other, never both.
export function EventLocation({city, initial}: {city?: City; initial: Record<string, string>}) {
  const t = useTranslations('Geo');
  const startLat = Number(initial.lat), startLng = Number(initial.lng);
  // An event saved without a venue away from the city centre was placed by hand.
  const placed = !initial.venueId && !!initial.lat && !!initial.lng && Number.isFinite(startLat) && Number.isFinite(startLng)
    && !!city && (startLat !== city.lat || startLng !== city.lng);
  const [custom, setCustom] = useState(placed);
  const [lat, setLat] = useState(placed ? String(startLat) : city?.lat !== undefined ? String(city.lat) : '');
  const [lng, setLng] = useState(placed ? String(startLng) : city?.lng !== undefined ? String(city.lng) : '');
  const point = {lat: Number(lat), lng: Number(lng)};
  const valid = lat !== '' && lng !== '' && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  return <fieldset className="geo-event-location"><legend>{t('eventLocation')}</legend>
    {custom ? <input type="hidden" name="venueId" value=""/> : <VenuePicker name="venueId" cityId={city?.id || ''} initialVenueId={initial.venueId}/>}
    <input type="hidden" name="pin" value={custom && valid ? JSON.stringify(point) : ''}/>
    <label className="checkbox"><input type="checkbox" checked={custom} disabled={!city} onChange={event => setCustom(event.target.checked)}/>{t('pinToggle')}</label>
    {custom && <>
      <div className="form-grid">
        <label>{t('latitude')}<input type="number" inputMode="decimal" step="any" min={-90} max={90} required value={lat} onChange={event => setLat(event.target.value)}/></label>
        <label>{t('longitude')}<input type="number" inputMode="decimal" step="any" min={-180} max={180} required value={lng} onChange={event => setLng(event.target.value)}/></label>
      </div>
      <p className="field-note">{t('pinHint')}</p>
      {valid && <LocationMap key={lat + ',' + lng} lat={point.lat} lng={point.lng} label={city?.name || ''}/>}
    </>}
  </fieldset>;
}
