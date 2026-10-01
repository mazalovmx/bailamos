'use client';
import {useEffect, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../app/styles/geo.css';
import {brand, loadMapLibre, mapLocale, mapStyleUrl, tint} from './maplibre';
// Single-marker map for event and venue pages. The label and the link below are the non-map alternative.
export function LocationMap({lat, lng, label}: {lat: number; lng: number; label: string}) {
  const t = useTranslations('Geo'), box = useRef<HTMLDivElement>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false, remove = () => {};
    loadMapLibre().then(lib => {
      if (cancelled || !box.current) return;
      const map = new lib.Map({container: box.current, style: mapStyleUrl, center: [lng, lat], zoom: 15, cooperativeGestures: true, locale: mapLocale(t)});
      remove = () => map.remove();
      map.addControl(new lib.NavigationControl({showCompass: false}), 'top-right');
      map.on('style.load', () => tint(map));
      const marker = new lib.Marker({color: brand.dark}).setLngLat([lng, lat]).addTo(map);
      marker.getElement().setAttribute('aria-label', label);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; remove(); };
    // The translator is stable for a given locale; the map is rebuilt only when the place changes.
  }, [lat, lng, label]);
  return <figure style={{margin: 0}}>
    <div className="geo-map small" ref={box} role="region" aria-label={t('mapOf', {label})}>{failed && <p className="geo-map-fallback">{t('mapUnavailable')}</p>}</div>
    <figcaption className="field-note" style={{marginTop: 8}}>{label} · <a href={'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=17/' + lat + '/' + lng} target="_blank" rel="noopener noreferrer">{t('openInOsm')}</a></figcaption>
  </figure>;
}
