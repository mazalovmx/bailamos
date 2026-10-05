'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import type {Map as MapType, Marker} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {brand, loadMapLibre, mapLocale, mapStyleUrl, tint} from '../geo/maplibre';
import '../../app/styles/geo.css';
export type CityChoice = {id: string; name: string; countryCode?: string; timezone?: string; lat?: number; lng?: number};
type Point = {lat: number; lng: number};
type Venue = {id: string; name: string; address: string; lat: number; lng: number};
const round = (point: Point): Point => ({lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6))});
const km = (a: Point, b: Point) => {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
/**
 * Where the event happens. Two ways in, one result:
 *   - click the map: the nearest city and its country are filled in and the click becomes the marker;
 *   - choose country and city, type an address or pick a venue: the marker is placed for you to check and adjust.
 * Either way an exact marker is required — an event in a park or on a square has no address to rely on.
 * Submits cityId, venueId, address and pin (JSON {lat,lng}; empty while a venue is selected).
 */
export function EventPlace({cities, cityId, onCity, initial}: {cities: CityChoice[]; cityId: string; onCity: (cityId: string) => void; initial: Record<string, string>}) {
  const t = useTranslations('App'), x = useTranslations('EventsX'), geo = useTranslations('Geo'), locale = useLocale();
  const city = cities.find(item => item.id === cityId);
  const startPin = initial.lat && initial.lng && Number.isFinite(Number(initial.lat)) && Number.isFinite(Number(initial.lng)) ? {lat: Number(initial.lat), lng: Number(initial.lng)} : null;
  const [country, setCountry] = useState(city?.countryCode?.trim() || ''), [venues, setVenues] = useState<Venue[]>([]), [venueId, setVenueId] = useState(initial.venueId || '');
  const [address, setAddress] = useState(initial.address || ''), [pin, setPin] = useState<Point | null>(startPin), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null), map = useRef<MapType | null>(null), marker = useRef<Marker | null>(null);
  const live = useRef({city, onCity, setPin, setVenueId, x});
  live.current = {city, onCity, setPin, setVenueId, x};
  // Country names come from the runtime's locale data, which differs between the server and browsers: the list starts
  // with plain codes (identical on both sides) and gets its localized, sorted names after mount.
  const codes = useMemo(() => [...new Set(cities.map(item => item.countryCode?.trim()).filter((code): code is string => !!code))].sort(), [cities]);
  const [countries, setCountries] = useState(() => codes.map(code => ({code, name: code})));
  useEffect(() => {
    let names: Intl.DisplayNames | null = null;
    try {names = new Intl.DisplayNames([locale], {type: 'region'});} catch {/* codes stay */}
    setCountries(codes.map(code => ({code, name: names?.of(code) || code})).sort((first, second) => first.name.localeCompare(second.name, locale)));
  }, [codes, locale]);
  // The country follows the city when the city is set from the map or from a saved event.
  useEffect(() => {if (city?.countryCode) setCountry(city.countryCode.trim());}, [city?.countryCode]);
  // Venues of the chosen city; a venue of another city is dropped.
  useEffect(() => {
    if (!cityId) {setVenues([]); return;}
    const controller = new AbortController();
    fetch('/api/venues?cityId=' + encodeURIComponent(cityId), {signal: controller.signal}).then(response => response.ok ? response.json() : {venues: []})
      .then((data: {venues: Venue[]}) => {setVenues(data.venues); setVenueId(current => data.venues.some(venue => venue.id === current) ? current : '');}).catch(() => undefined);
    return () => controller.abort();
  }, [cityId]);
  // A marker placed by hand: the nearest city is looked up when none is chosen or the click is far from the chosen one.
  async function place(point: Point) {
    const clean = round(point), now = live.current;
    now.setVenueId(''); now.setPin(clean);
    const chosen = now.city;
    if (chosen?.lat !== undefined && chosen.lng !== undefined && km(clean, {lat: chosen.lat, lng: chosen.lng}) <= 100) {setStatus(now.x('placeSet')); return;}
    setStatus(now.x('pickSearching'));
    try {
      const response = await fetch('/api/geo/locate?lat=' + clean.lat + '&lng=' + clean.lng), data = await response.json();
      if (response.ok && data.city) {now.onCity(data.city.id); setStatus(now.x('pickFound', {city: data.city.name}));}
      else {now.setPin(null); setStatus(now.x('pickNoCity'));}
    } catch {now.setPin(null); setStatus(now.x('pickNoCity'));}
  }
  const placeRef = useRef(place);
  placeRef.current = place;
  useEffect(() => {
    let cancelled = false;
    loadMapLibre().then(lib => {
      if (cancelled || !box.current) return;
      const at = startPin || (city?.lat !== undefined && city.lng !== undefined ? {lat: city.lat, lng: city.lng} : null);
      const instance = new lib.Map({container: box.current, style: mapStyleUrl, center: at ? [at.lng, at.lat] : [0, 30], zoom: startPin ? 15 : at ? 11 : 1.2,
        cooperativeGestures: true, locale: mapLocale(geo)});
      map.current = instance;
      instance.addControl(new lib.NavigationControl({showCompass: false}), 'top-right');
      instance.on('style.load', () => tint(instance));
      instance.on('click', event => {void placeRef.current({lat: event.lngLat.lat, lng: event.lngLat.lng});});
      const mark = new lib.Marker({color: brand.dark, draggable: true});
      marker.current = mark;
      mark.on('dragend', () => {const point = mark.getLngLat(); void placeRef.current({lat: point.lat, lng: point.lng});});
      const element = mark.getElement();
      element.tabIndex = 0; element.setAttribute('aria-label', geo('pinKeyboard'));
      element.addEventListener('keydown', event => {
        const step = event.shiftKey ? 0.001 : 0.0001, delta = ({ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step]} as Record<string, number[]>)[event.key];
        if (!delta) return;
        event.preventDefault(); event.stopPropagation();
        const point = mark.getLngLat();
        void placeRef.current({lat: point.lat + delta[0], lng: point.lng + delta[1]});
      });
      if (startPin) mark.setLngLat([startPin.lng, startPin.lat]).addTo(instance);
    }).catch(() => setStatus(geo('pinMapUnavailable')));
    return () => {cancelled = true; map.current?.remove(); map.current = null; marker.current = null;};
  // The map is created once; city, venue and marker changes are applied by the effects below.
  }, []);
  // The marker follows the state.
  useEffect(() => {
    if (!map.current || !marker.current) return;
    if (pin) {marker.current.setLngLat([pin.lng, pin.lat]).addTo(map.current); map.current.easeTo({center: [pin.lng, pin.lat], zoom: Math.max(map.current.getZoom(), 14)});}
    else marker.current.remove();
  }, [pin]);
  // Choosing another city moves the map there; a marker left far away in the previous city is removed.
  useEffect(() => {
    if (city?.lat === undefined || city.lng === undefined) return;
    const centre = {lat: city.lat, lng: city.lng};
    if (pin && km(pin, centre) > 100) setPin(null);
    if (!pin || km(pin, centre) > 100) map.current?.easeTo({center: [centre.lng, centre.lat], zoom: 11});
  }, [cityId]);
  function chooseVenue(id: string) {
    setVenueId(id);
    const venue = venues.find(item => item.id === id);
    if (venue) {setPin(round(venue)); setAddress(venue.address); setStatus(x('placeVenue', {name: venue.name}));}
  }
  async function findAddress() {
    if (!address.trim() || !cityId) return;
    setBusy(true); setStatus(x('pickSearching'));
    try {
      const response = await fetch('/api/geo/search?q=' + encodeURIComponent(address.trim()) + '&cityId=' + encodeURIComponent(cityId) + '&lang=' + locale);
      const data = response.ok ? await response.json() as {results: Point[]} : {results: []}, found = data.results[0];
      if (found) {setVenueId(''); setPin(round(found)); setStatus(x('addressFound'));} else setStatus(x('addressNotFound'));
    } catch {setStatus(x('addressNotFound'));} finally {setBusy(false);}
  }
  const inCountry = cities.filter(item => !country || item.countryCode?.trim() === country);
  return <fieldset className="geo-event-location event-place"><legend>{x('placeTitle')}</legend>
    <p className="field-note">{x('placeHint')}</p>
    <div className="form-grid">
      <label>{x('country')}<select value={country} onChange={event => {setCountry(event.target.value); if (city && city.countryCode?.trim() !== event.target.value) onCity('');}}>
        <option value="">{x('countryAny')}</option>{countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label>{t('city')}<select name="cityId" required value={cityId} onChange={event => onCity(event.target.value)}>
        <option value="">{t('choose')}</option>{inCountry.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <label>{x('venueOptional')}<select value={venueId} disabled={!cityId} onChange={event => chooseVenue(event.target.value)}>
      <option value="">{x(cityId ? 'venueNoneHere' : 'venueChooseCity')}</option>{venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name} — {venue.address}</option>)}</select></label>
    <div className="event-place-address"><label>{x('address')}<input name="address" maxLength={200} value={address} onChange={event => setAddress(event.target.value)} placeholder={x('addressPlaceholder')} autoComplete="off"/></label>
      <button type="button" className="button secondary" disabled={busy || !cityId || address.trim().length < 3} onClick={findAddress}>{x('addressFind')}</button></div>
    <input type="hidden" name="venueId" value={venueId}/>
    <input type="hidden" name="pin" value={pin && !venueId ? JSON.stringify(pin) : ''}/>
    <p className="field-note" id="event-place-help">{x('placeMapHelp')}</p>
    <div className="geo-map small" ref={box} role="region" aria-label={x('placeTitle')} aria-describedby="event-place-help"/>
    <p role="status" aria-live="polite" className={pin ? 'field-note' : 'form-error'}>{status || x(pin ? 'placeSet' : 'placeMissing')}</p>
  </fieldset>;
}
