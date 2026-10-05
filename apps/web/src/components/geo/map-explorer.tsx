'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import Supercluster from 'supercluster';
import type {GeoJSONSource, Map as MapLibreMap, Popup} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../app/styles/geo.css';
import {brand, circle, loadMapLibre, mapLocale, mapStyleUrl, tint, type MapLibreModule} from './maplibre';
import {nearMe} from './near-me';
import {DateTime} from 'luxon';
import {queryParams,values,type SearchQuery} from '../../lib/search-query';
import {DiscoveryNav} from '../discovery-nav';
import {classLevels} from '../../lib/swing';
import {MultiFilter} from '../multi-filter';
type City = {id: string; slug: string; name: string; lat: number; lng: number;timezone:string};
type Option = {id: string; name: string};
type MapEvent = {id: string; slug: string; title: string; kind: string; timezone: string; lat: number; lng: number; startsAt: string; city: string; venue: string | null; styles: string[]; distanceM: number | null};
type Origin = {lat: number; lng: number; kind: 'city' | 'me' | 'map'; name?: string};
type Filters = {city: string; style: string; from: string; to: string; radius: number;level?:string};
const radii = [5, 10, 25, 50, 100];
const VIEW_LIMIT = 1000, RADIUS_LIMIT = 500, PAGE = 30, MAX_CLUSTER_ZOOM = 16;
const empty = {type: 'FeatureCollection' as const, features: []};
// Events on a map with client-side clustering, plus the same events as a list for people who cannot or do not want to use the map.
export function MapExplorer({locale, cities, styles, initial, defaults, centre,discovery={}}: {
  discovery?:SearchQuery;
  locale: string; cities: City[]; styles: Option[]; initial: Filters; defaults: {from: string; to: string}; centre: {lat: number; lng: number; zoom: number};
}) {
  const t = useTranslations('Geo'), app = useTranslations('App');
  const startCity = cities.find(city => city.slug === initial.city);
  const [filters, setFilters] = useState({...initial,level:values(discovery.level)[0]||''});
  const [multi,setMulti]=useState({city:values(discovery.city).filter(c=>c!=='all').map(c=>cities.find(item=>item.id===c||item.slug===c)?.slug||c),style:values(discovery.style),level:values(discovery.level)});
  const activeQuery=useMemo(()=>({...discovery,
    city:multi.city.length?multi.city:['all'],style:multi.style,level:multi.level,
    from:filters.from,to:filters.to}),[discovery,filters,multi]);
  const [origin, setOrigin] = useState<Origin | null>(startCity ? {lat: startCity.lat, lng: startCity.lng, kind: 'city', name: startCity.name} : initial.radius ? {...centre, kind: 'map'} : null);
  const [bounds, setBounds] = useState<string | null>(null), [events, setEvents] = useState<MapEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [mapFailed, setMapFailed] = useState(false), [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [shown, setShown] = useState(PAGE), [locating, setLocating] = useState(false), [problem, setProblem] = useState('');
  const box = useRef<HTMLDivElement>(null), lib = useRef<MapLibreModule | null>(null), map = useRef<MapLibreMap | null>(null), popup = useRef<Popup | null>(null);
  const byId = useMemo(() => new Map(events.map(event => [event.id, event])), [events]);
  const index = useMemo(() => new Supercluster<{id: string}>({radius: 56, maxZoom: MAX_CLUSTER_ZOOM}).load(events.map(event =>
    ({type: 'Feature' as const, properties: {id: event.id}, geometry: {type: 'Point' as const, coordinates: [event.lng, event.lat]}}))), [events]);
  const live = useRef({index, byId});
  live.current = {index, byId};
  const when = useCallback((event: MapEvent) => new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone}).format(new Date(event.startsAt)), [locale]);
  const href = useCallback((event: MapEvent) => '/' + locale + '/events/' + event.slug + '?date=' + encodeURIComponent(event.startsAt), [locale]);
  const message = (code: string) => t.has('error_' + code) ? t('error_' + code) : app.has('error_' + code) ? app('error_' + code) : app('error_GENERIC');
  // Popover listing one or several events; built from DOM nodes so that titles are never parsed as markup.
  const showEvents = useCallback((items: MapEvent[], at: [number, number], focus = true) => {
    if (!map.current || !lib.current || !items.length) return;
    const node = document.createElement('div'), list = document.createElement('ul');
    node.className = 'geo-popup';
    if (items.length > 1) { const heading = document.createElement('h3'); heading.textContent = t('eventCount', {count: items.length}); node.append(heading); }
    for (const event of items) {
      const item = document.createElement('li'), link = document.createElement('a'), meta = document.createElement('small');
      link.href = href(event); link.textContent = event.title;
      meta.textContent = [when(event), event.venue || event.city].join(' · ');
      item.append(link, meta); list.append(item);
    }
    node.append(list);
    // One event: its photo and note are fetched on demand and added as plain elements, never as markup.
    // The popup grows once they arrive, so the map is then moved until the whole popup is inside it.
    const fit = () => {
      const instance = map.current, element = popup.current?.getElement();
      if (!instance || !element?.isConnected) return;
      const inner = element.getBoundingClientRect(), outer = instance.getContainer().getBoundingClientRect(), gap = 12;
      const dx = inner.right > outer.right - gap ? inner.right - outer.right + gap : inner.left < outer.left + gap ? inner.left - outer.left - gap : 0;
      // The bottom edge keeps room for the attribution line, which sits on top of the map.
      const dy = inner.bottom > outer.bottom - 52 ? inner.bottom - outer.bottom + 52 : inner.top < outer.top + gap ? inner.top - outer.top - gap : 0;
      if (dx || dy) instance.panBy([dx, dy]);
    };
    if (items.length === 1) fetch('/api/events/' + encodeURIComponent(items[0].id) + '/place').then(response => response.ok ? response.json() : null).then((place: {note: string | null; image: string | null} | null) => {
      if (!place || !node.isConnected) return;
      if (place.image) { const image = document.createElement('img'); image.src = place.image; image.alt = t('popupPhotoAlt'); image.className = 'geo-popup-photo'; image.onload = fit; node.append(image); }
      if (place.note) { const note = document.createElement('p'); note.className = 'geo-popup-note'; note.textContent = place.note; node.append(note); }
      fit();
    }).catch(() => undefined);
    popup.current?.remove();
    popup.current = new lib.current.Popup({maxWidth: 'min(320px, 80vw)', offset: 12}).setLngLat(at).setDOMContent(node).addTo(map.current);
    if (focus) node.querySelector('a')?.focus({preventScroll: true});
  }, [href, when, t]);
  const actions = useRef({showEvents});
  actions.current = {showEvents};
  // Re-clusters for the current viewport; cheap enough to run on every move.
  const draw = useCallback(() => {
    const instance = map.current, source = instance?.getSource('events') as GeoJSONSource | undefined;
    if (!instance || !source) return;
    const view = instance.getBounds(), wide = view.getEast() - view.getWest() >= 360;
    const clusters = live.current.index.getClusters([wide ? -180 : view.getWest(), Math.max(-90, view.getSouth()), wide ? 180 : view.getEast(), Math.min(90, view.getNorth())], Math.floor(instance.getZoom()));
    source.setData({type: 'FeatureCollection', features: clusters});
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadMapLibre().then(module => {
      if (cancelled || !box.current) return;
      const instance = new module.Map({container: box.current, style: mapStyleUrl, center: [centre.lng, centre.lat], zoom: centre.zoom, maxZoom: 18, cooperativeGestures: true, locale: mapLocale(t)});
      lib.current = module; map.current = instance;
      instance.addControl(new module.NavigationControl({showCompass: false}), 'top-right');
      const report = () => {
        const view = instance.getBounds(), span = view.getEast() - view.getWest();
        const wrap = (lng: number) => ((lng + 540) % 360 + 360) % 360 - 180;
        setBounds([span >= 360 ? -180 : wrap(view.getWest()), Math.max(-90, view.getSouth()), span >= 360 ? 180 : wrap(view.getEast()), Math.min(90, view.getNorth())].map(value => value.toFixed(4)).join(','));
      };
      let timer: ReturnType<typeof setTimeout>;
      instance.on('load', () => {
        if (cancelled) return;
        tint(instance);
        instance.addSource('radius', {type: 'geojson', data: empty});
        instance.addLayer({id: 'radius-fill', type: 'fill', source: 'radius', paint: {'fill-color': brand.dark, 'fill-opacity': 0.06}});
        instance.addLayer({id: 'radius-line', type: 'line', source: 'radius', paint: {'line-color': brand.dark, 'line-width': 2, 'line-dasharray': [2, 2]}});
        // One GeoJSON source drawn on the GPU: a thousand events cost a few milliseconds, unlike DOM markers.
        instance.addSource('events', {type: 'geojson', data: empty});
        instance.addLayer({id: 'clusters', type: 'circle', source: 'events', filter: ['has', 'point_count'],
          paint: {'circle-color': brand.dark, 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 100, 27], 'circle-stroke-width': 3, 'circle-stroke-color': brand.lime}});
        instance.addLayer({id: 'cluster-count', type: 'symbol', source: 'events', filter: ['has', 'point_count'],
          layout: {'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true}, paint: {'text-color': '#ffffff'}});
        instance.addLayer({id: 'points', type: 'circle', source: 'events', filter: ['!', ['has', 'point_count']],
          paint: {'circle-color': brand.lime, 'circle-radius': 9, 'circle-stroke-width': 3, 'circle-stroke-color': brand.dark}});
        instance.on('click', 'clusters', event => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;
          const at = feature.geometry.coordinates as [number, number], id = Number(feature.properties.cluster_id), count = Number(feature.properties.point_count);
          const zoom = live.current.index.getClusterExpansionZoom(id);
          // Small clusters and events that share one address are listed; larger clusters open up on zoom.
          if (count <= 8 || zoom > MAX_CLUSTER_ZOOM) {
            const items = live.current.index.getLeaves(id, 50).map(leaf => live.current.byId.get(leaf.properties.id)).filter((item): item is MapEvent => !!item);
            actions.current.showEvents(items.sort((a, b) => a.startsAt.localeCompare(b.startsAt)), at);
          } else instance.easeTo({center: at, zoom});
        });
        instance.on('click', 'points', event => {
          const ids = [...new Set((event.features || []).map(feature => String(feature.properties.id)))];
          const items = ids.map(id => live.current.byId.get(id)).filter((item): item is MapEvent => !!item);
          if (items.length) actions.current.showEvents(items, [items[0].lng, items[0].lat]);
        });
        for (const layer of ['clusters', 'points']) {
          instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer'; });
          instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = ''; });
        }
        instance.on('move', draw);
        instance.on('moveend', () => { clearTimeout(timer); timer = setTimeout(report, 250); });
        setReady(true); report();
      });
    }).catch(() => { if (!cancelled) setMapFailed(true); });
    return () => { cancelled = true; popup.current?.remove(); map.current?.remove(); map.current = null; };
    // Runs once: the map lives as long as the page.
  }, []);
  useEffect(() => { if (ready) draw(); }, [ready, index, draw]);
  // If the base map has not loaded after a while (slow or blocked tile server), the list stops waiting for it.
  useEffect(() => { const timer = setTimeout(() => setStalled(true), 6000); return () => clearTimeout(timer); }, []);
  // Radius outline, and the camera follows the search area.
  useEffect(() => {
    const instance = map.current, source = instance?.getSource('radius') as GeoJSONSource | undefined;
    if (!ready || !instance || !source) return;
    if (!origin || !filters.radius) { source.setData(empty); return; }
    const ring = circle(origin.lat, origin.lng, filters.radius), lngs = ring.map(point => point[0]), lats = ring.map(point => point[1]);
    source.setData({type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [ring]}});
    instance.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {padding: 24, maxZoom: 14});
  }, [ready, origin, filters.radius]);
  const radiusMode = filters.radius > 0 && !!origin;
  // Without a working map (no WebGL, blocked tiles) the list still works: it falls back to a radius around the chosen place.
  const fallback = (mapFailed || stalled) && !ready && !radiusMode ? origin || centre : null;
  const request = useMemo(() => {
    const zone=multi.city.length===1?cities.find(c=>c.slug===multi.city[0])?.timezone||'UTC':'UTC';
    const start = DateTime.fromISO(filters.from,{zone}).startOf('day').toJSDate(), end = DateTime.fromISO(filters.to,{zone}).plus({days:1}).startOf('day').toJSDate();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    const params=queryParams({...activeQuery,from:start.toISOString(),to:end.toISOString()});params.delete('radius');params.delete('page');
    const range = '&'+params;
    if (radiusMode && origin) return '/api/events/nearby?lat=' + origin.lat + '&lng=' + origin.lng + '&radiusKm=' + filters.radius + '&limit=' + RADIUS_LIMIT + range;
    if (fallback) return '/api/events/nearby?lat=' + fallback.lat + '&lng=' + fallback.lng + '&radiusKm=50&limit=' + RADIUS_LIMIT + range;
    return bounds ? '/api/geo/events?bbox=' + bounds + '&limit=' + VIEW_LIMIT + range : null;
  }, [filters, origin, radiusMode, fallback, bounds,activeQuery,cities,multi.city]);
  useEffect(() => {
    if (!request) { if (filters.to < filters.from) { setEvents([]); setStatus('error'); } return; }
    const controller = new AbortController();
    setStatus('loading');
    fetch(request, {signal: controller.signal}).then(response => response.ok ? response.json() : Promise.reject(new Error('GENERIC')))
      .then((data: {events: MapEvent[]}) => { setEvents(data.events); setStatus('ready'); })
      .catch(error => { if (error?.name !== 'AbortError') setStatus('error'); });
    return () => controller.abort();
  }, [request, filters.from, filters.to]);
  // Filters live in the address bar, so a view can be shared or bookmarked.
  useEffect(() => {
    const params = queryParams(activeQuery);
    if (filters.from !== defaults.from || filters.to !== defaults.to) { params.set('from', filters.from); params.set('to', filters.to); }
    if (filters.radius) params.set('radius', String(filters.radius));
    window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params : ''));
  }, [filters, defaults.from, defaults.to,activeQuery]);
  const update = (patch: Partial<Filters>) => {if(patch.city!==undefined)setMulti(current=>({...current,city:patch.city?[patch.city]:[]})); setFilters(current => ({...current, ...patch})); setShown(PAGE); popup.current?.remove(); };
  const chooseCity = (slug: string) => {
    const city = cities.find(item => item.slug === slug);
    update({city: slug});
    if (!city) { if (origin?.kind === 'city') setOrigin(null); return; }
    setOrigin({lat: city.lat, lng: city.lng, kind: 'city', name: city.name});
    if (!filters.radius) map.current?.flyTo({center: [city.lng, city.lat], zoom: 11});
  };
  const chooseRadius = (radius: number) => {
    if (radius && !origin) {
      const at = map.current?.getCenter();
      setOrigin({lat: Number((at?.lat ?? centre.lat).toFixed(4)), lng: Number((at?.lng ?? centre.lng).toFixed(4)), kind: 'map'});
    }
    update({radius});
  };
  const locate = async () => {
    setLocating(true); setProblem('');
    try {
      const place = await nearMe();
      setOrigin({lat: place.lat, lng: place.lng, kind: 'me'});
      update({city: place.city?.slug || '', radius: filters.radius || 25});
    } catch (error) { setProblem(error instanceof Error ? error.message : 'GENERIC'); } finally { setLocating(false); }
  };
  const focusEvent = (event: MapEvent) => {
    if (!map.current) return;
    map.current.easeTo({center: [event.lng, event.lat], zoom: Math.max(map.current.getZoom(), 14)});
    showEvents(events.filter(item => item.lat === event.lat && item.lng === event.lng), [event.lng, event.lat], false);
    box.current?.scrollIntoView({block: 'nearest'});
  };
  const limit = radiusMode || fallback ? RADIUS_LIMIT : VIEW_LIMIT;
  const area = radiusMode && origin ? t(origin.kind === 'me' ? 'areaMe' : origin.kind === 'city' ? 'areaCity' : 'areaMap', {radius: filters.radius, city: origin.name || ''}) : fallback ? t('areaFallback') : t('areaView');
  return <>
    <DiscoveryNav locale={locale} query={activeQuery}/>
    <form className="geo-filters" onSubmit={event => event.preventDefault()} aria-label={t('filters')}>
      <MultiFilter name="city" label={app('city')} all={app('allCities')} items={cities.map(c=>({id:c.slug,name:c.name}))} initial={multi.city} selection={multi.city} onChange={city=>{chooseCity(city[0]||'');setMulti(current=>({...current,city}));}}/>
      <MultiFilter name="style" label={app('style')} all={app('allStyles')} items={styles} initial={multi.style} selection={multi.style} onChange={style=>{setMulti(current=>({...current,style}));setShown(PAGE);}}/>
      <label>{t('from')}<input type="date" required value={filters.from} max={filters.to} onChange={event => event.target.value && update({from: event.target.value})}/></label>
      <MultiFilter name="level" label={app('classLevel')} all={app('allLevels')} items={classLevels.map(id=>({id,name:app('level_'+id)}))} initial={multi.level} selection={multi.level} onChange={level=>{setMulti(current=>({...current,level}));setShown(PAGE);}}/>
      <label>{t('to')}<input type="date" required value={filters.to} min={filters.from} onChange={event => event.target.value && update({to: event.target.value})}/></label>
      <label>{t('radius')}<select value={filters.radius} onChange={event => chooseRadius(Number(event.target.value))}>
        <option value={0}>{t('radiusView')}</option>{radii.map(km => <option key={km} value={km}>{t('radiusKm', {radius: km})}</option>)}</select></label>
    </form>
    <div className="geo-actions">
      <button type="button" className="button secondary" disabled={locating} onClick={locate}><span aria-hidden="true">◎</span> {locating ? t('locating') : t('nearMe')}</button>
      <p className="geo-status" role="status" aria-live="polite">{status === 'loading' ? t('loading') : status === 'error' ? t('loadError')
        : t('found' + (events.length >= limit ? 'Limited' : 'Events'), {count: events.length}) + ' ' + area}</p>
    </div>
    {problem && <p role="alert" className="form-error" style={{marginBottom: 14}}>{message(problem)}</p>}
    <div className="geo-map" ref={box} role="region" aria-label={t('mapRegion')}>{mapFailed && <p className="geo-map-fallback">{t('mapUnavailable')}</p>}</div>
    <p className="field-note" style={{marginTop: 8}}>{t('mapHelp')}</p>
    <section id="geo-event-list" aria-labelledby="geo-event-list-title" tabIndex={-1}>
      <h2 id="geo-event-list-title">{t('listTitle')}</h2>
      {status === 'ready' && !events.length ? <div className="empty"><span aria-hidden="true">✳</span><div><h3>{t('empty')}</h3><p>{t('emptyText')}</p></div></div> :
        <ol className="geo-list">{events.slice(0, shown).map(event => <li key={event.id}>
          <a href={href(event)}>{event.title}</a>
          <p><time dateTime={event.startsAt}>{when(event)}</time></p>
          <p>{[event.venue, event.city, event.distanceM === null ? '' : t('distance', {km: (event.distanceM / 1000).toFixed(1)})].filter(Boolean).join(' · ')}</p>
          {event.styles.length > 0 && <p>{event.styles.join(', ')}</p>}
          {!mapFailed && <button type="button" className="geo-link-button" onClick={() => focusEvent(event)}>{t('showOnMap')}<span className="sr-only"> — {event.title}</span></button>}
        </li>)}</ol>}
      {events.length > shown && <button type="button" className="button secondary" onClick={() => setShown(shown + PAGE)}>{t('showMore')}</button>}
    </section>
  </>;
}
