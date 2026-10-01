'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import type {Map as MapLibreMap, Marker} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../app/styles/geo.css';
import {brand, loadMapLibre, mapLocale, mapStyleUrl, tint, type MapLibreModule} from './maplibre';
type City = {id: string; name: string; lat: number; lng: number};
type Point = {lat: number; lng: number};
type Result = Point & {label: string};
const round = (value: number) => Number(value.toFixed(6));
async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {signal}), data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GENERIC');
  return data;
}
// New venue: address with autocomplete, a marker that can be dragged, clicked into place or moved with the arrow keys,
// and plain coordinate fields as the non-map alternative.
export function VenueForm({cities, initialCityId}: {cities: City[]; initialCityId?: string}) {
  const t = useTranslations('Geo'), app = useTranslations('App'), locale = useLocale(), router = useRouter(), listId = useId();
  const [cityId, setCityId] = useState(initialCityId || ''), [address, setAddress] = useState(''), [point, setPoint] = useState<Point | null>(null);
  const [options, setOptions] = useState<Result[]>([]), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [suggested, setSuggested] = useState(''), [busy, setBusy] = useState(false), [searching, setSearching] = useState(false);
  const [error, setError] = useState(''), [note, setNote] = useState(''), [ready, setReady] = useState(false), [mapFailed, setMapFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null), lib = useRef<MapLibreModule | null>(null), map = useRef<MapLibreMap | null>(null), marker = useRef<Marker | null>(null);
  const [latText, setLatText] = useState(''), [lngText, setLngText] = useState('');
  const picked = useRef(false), addressRef = useRef(address), reverseRun = useRef(0);
  addressRef.current = address;
  // Fills the address field without triggering autocomplete for the text just chosen.
  const fill = (label: string) => { if (label !== addressRef.current) { picked.current = true; setAddress(label); } };
  const city = cities.find(item => item.id === cityId);
  const message = (code: string) => t.has('error_' + code) ? t('error_' + code) : app.has('error_' + code) ? app('error_' + code) : app('error_GENERIC');
  // The marker was moved by hand: remember the spot and propose the address found there.
  const moved = (next: Point) => {
    const spot = {lat: round(Math.max(-90, Math.min(90, next.lat))), lng: round(Math.max(-180, Math.min(180, next.lng)))}, run = ++reverseRun.current;
    setPoint(spot);
    setSuggested('');
    getJson('/api/geo/reverse?lat=' + spot.lat + '&lng=' + spot.lng + '&lang=' + locale).then(data => {
      if (run !== reverseRun.current || !data.result?.label) return;
      if (addressRef.current.trim()) setSuggested(data.result.label);
      else fill(data.result.label);
    }).catch(() => undefined);
  };
  const movedRef = useRef(moved);
  movedRef.current = moved;
  useEffect(() => {
    let cancelled = false;
    loadMapLibre().then(module => {
      if (cancelled || !box.current) return;
      const start = cities.find(item => item.id === (initialCityId || ''));
      const instance = new module.Map({container: box.current, style: mapStyleUrl, center: start ? [start.lng, start.lat] : [0, 30], zoom: start ? 11 : 1.2, cooperativeGestures: true, locale: mapLocale(t)});
      instance.addControl(new module.NavigationControl({showCompass: false}), 'top-right');
      instance.on('style.load', () => tint(instance));
      instance.on('click', event => movedRef.current({lat: event.lngLat.lat, lng: event.lngLat.lng}));
      lib.current = module; map.current = instance;
      setReady(true);
    }).catch(() => { if (!cancelled) setMapFailed(true); });
    return () => { cancelled = true; map.current?.remove(); map.current = null; marker.current = null; };
    // Runs once: the map is created for the lifetime of the form.
  }, []);
  useEffect(() => {
    if (!ready || !map.current || !lib.current) return;
    if (!point) { if (city) map.current.easeTo({center: [city.lng, city.lat], zoom: 11}); return; }
    if (!marker.current) {
      const pin = new lib.current.Marker({color: brand.dark, draggable: true}).setLngLat([point.lng, point.lat]).addTo(map.current), element = pin.getElement();
      pin.on('dragend', () => { const at = pin.getLngLat(); movedRef.current({lat: at.lat, lng: at.lng}); });
      element.tabIndex = 0;
      element.setAttribute('aria-label', t('markerHint'));
      element.addEventListener('keydown', event => {
        const step = (event.shiftKey ? 0.001 : 0.0001), at = pin.getLngLat();
        const delta = ({ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step]} as Record<string, number[]>)[event.key];
        if (!delta) return;
        event.preventDefault(); event.stopPropagation();
        movedRef.current({lat: at.lat + delta[0], lng: at.lng + delta[1]});
      });
      marker.current = pin;
    }
    marker.current.setLngLat([point.lng, point.lat]);
    map.current.easeTo({center: [point.lng, point.lat], zoom: Math.max(map.current.getZoom(), 15)});
  }, [ready, point, cityId]);
  // The coordinate fields follow the marker, but keep whatever is being typed until it is a valid number.
  useEffect(() => {
    if (!point) return;
    setLatText(current => current !== '' && Number(current) === point.lat ? current : String(point.lat));
    setLngText(current => current !== '' && Number(current) === point.lng ? current : String(point.lng));
  }, [point]);
  // Autocomplete while typing. The server answers with an empty list when the configured geocoder does not allow it.
  useEffect(() => {
    if (picked.current) { picked.current = false; return; }
    const q = address.trim();
    if (q.length < 3) { setOptions([]); setOpen(false); return; }
    const controller = new AbortController(), timer = setTimeout(() => {
      getJson('/api/geo/search?mode=suggest&q=' + encodeURIComponent(q) + (cityId ? '&cityId=' + encodeURIComponent(cityId) : '') + '&lang=' + locale, controller.signal)
        .then(data => { setOptions(data.results); setOpen(data.results.length > 0); setActive(-1); }).catch(() => undefined);
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [address, cityId, locale]);
  const pick = (option: Result) => {
    reverseRun.current++;
    fill(option.label); setPoint({lat: round(option.lat), lng: round(option.lng)}); setSuggested(''); setOpen(false); setActive(-1);
    setNote(t('found', {address: option.label}));
  };
  const find = async () => {
    setError(''); setNote(''); setSearching(true);
    try {
      const data = await getJson('/api/geo/search?q=' + encodeURIComponent(address.trim()) + (cityId ? '&cityId=' + encodeURIComponent(cityId) : '') + '&lang=' + locale);
      if (!data.results.length) { setError('ADDRESS_NOT_FOUND'); return; }
      const [best] = data.results as Result[];
      reverseRun.current++;
      setPoint({lat: round(best.lat), lng: round(best.lng)}); setSuggested(best.label); setOpen(false);
      setNote(t('found', {address: best.label}));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'GENERIC'); } finally { setSearching(false); }
  };
  const coordinate = (key: 'lat' | 'lng', raw: string) => {
    (key === 'lat' ? setLatText : setLngText)(raw);
    const value = Number(raw), limit = key === 'lat' ? 90 : 180;
    if (raw === '' || !Number.isFinite(value) || Math.abs(value) > limit) return;
    reverseRun.current++;
    setPoint({lat: point?.lat ?? city?.lat ?? 0, lng: point?.lng ?? city?.lng ?? 0, [key]: round(value)});
  };
  return <form className="editor-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    const name = String(new FormData(event.currentTarget).get('name') || '');
    try {
      const response = await fetch('/api/venues', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, cityId, ...(address.trim() ? {address: address.trim()} : {}), ...(point || {}), lang: locale})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'GENERIC');
      router.push('/' + locale + '/venues/' + data.venue.id); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'GENERIC'); } finally { setBusy(false); }
  }}>
    <div className="form-grid">
      <label>{t('venueName')}<input name="name" required minLength={2} maxLength={120} autoComplete="organization"/></label>
      <label>{app('city')}<select name="cityId" required value={cityId} onChange={event => setCityId(event.target.value)}>
        <option value="">{app('choose')}</option>{cities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <div className="geo-inline">
      <label className="geo-combobox">{t('address')}
        <input value={address} maxLength={300} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? listId + '-' + active : undefined} aria-describedby={listId + '-hint'}
          onChange={event => setAddress(event.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={event => {
            if (event.key === 'Escape') { setOpen(false); return; }
            if (!open || !options.length) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((active + 1) % options.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((active - 1 + options.length) % options.length); }
            if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(options[active]); }
          }}/>
        <ul id={listId} role="listbox" aria-label={t('suggestions')} hidden={!open}>
          {options.map((option, index) => <li key={index} id={listId + '-' + index} role="option" aria-selected={index === active}
            onMouseDown={event => { event.preventDefault(); pick(option); }}>{option.label}</li>)}
        </ul>
      </label>
      <button type="button" className="button secondary" disabled={searching || address.trim().length < 3} onClick={find}>{searching ? t('searching') : t('findOnMap')}</button>
    </div>
    <p className="field-note" id={listId + '-hint'}>{t('addressHint')}</p>
    {suggested && suggested !== address && <p className="notice">{t('suggestedAddress', {address: suggested})}{' '}
      <button type="button" className="geo-link-button" onClick={() => { fill(suggested); setSuggested(''); }}>{t('useAddress')}</button></p>}
    <div className="geo-map small" ref={box} role="region" aria-label={t('venueMap')}>{mapFailed && <p className="geo-map-fallback">{t('mapUnavailable')}</p>}</div>
    <p className="field-note">{t('markerHelp')}</p>
    <div className="form-grid">
      <label>{t('latitude')}<input type="number" inputMode="decimal" step="any" min={-90} max={90} value={latText} onChange={event => coordinate('lat', event.target.value)}/></label>
      <label>{t('longitude')}<input type="number" inputMode="decimal" step="any" min={-180} max={180} value={lngText} onChange={event => coordinate('lng', event.target.value)}/></label>
    </div>
    <p className="field-note">{t('coordsHint')}</p>
    <p className="sr-only" role="status">{note}</p>
    {error && <p role="alert" className="form-error">{message(error)}</p>}
    <button className="button" disabled={busy}>{busy ? app('working') : t('saveVenue')}</button>
  </form>;
}
