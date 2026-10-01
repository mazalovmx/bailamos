import type * as MapLibre from 'maplibre-gl';
// MapLibre is browser-only: it is imported on demand from effects, never during server rendering.
export type MapLibreModule = typeof MapLibre;
export const mapStyleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
export const brand = {dark: '#253b2f', lime: '#dafa7c', paper: '#f6f4ee', water: '#c9dcd9', green: '#dfe8cb'};
let loading: Promise<MapLibreModule> | undefined;
export function loadMapLibre(): Promise<MapLibreModule> {
  loading ??= import('maplibre-gl').then(lib => {
    // The worker has to be a same-origin module with its sibling chunk next to it; see app/api/geo/maplibre/[file].
    lib.setWorkerUrl(new URL('/api/geo/maplibre/maplibre-gl-worker.mjs', window.location.origin).href);
    return lib;
  });
  loading.catch(() => { loading = undefined; });
  return loading;
}
// Recolours the base map towards the site palette. Layer names vary between styles, so every change is best-effort.
export function tint(map: MapLibre.Map) {
  for (const layer of map.getStyle().layers || []) {
    try {
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', brand.paper);
      else if (layer.type === 'fill' && /water/.test(layer.id)) map.setPaintProperty(layer.id, 'fill-color', brand.water);
      else if (layer.type === 'fill' && /park|wood|grass|forest|green/.test(layer.id)) map.setPaintProperty(layer.id, 'fill-color', brand.green);
      else if (layer.type === 'line' && /waterway/.test(layer.id)) map.setPaintProperty(layer.id, 'line-color', brand.water);
    } catch { /* a style without this property keeps its own colour */ }
  }
}
// Translated labels for MapLibre's own controls.
export function mapLocale(t: (key: string) => string): Record<string, string> {
  return {'Map.Title': t('mapLabel'), 'Marker.Title': t('marker'), 'Popup.Close': t('closePopup'), 'NavigationControl.ZoomIn': t('zoomIn'),
    'NavigationControl.ZoomOut': t('zoomOut'), 'NavigationControl.ResetBearing': t('resetNorth'),
    'CooperativeGesturesHandler.WindowsHelpText': t('gestureDesktop'), 'CooperativeGesturesHandler.MacHelpText': t('gestureDesktop'),
    'CooperativeGesturesHandler.MobileHelpText': t('gestureMobile')};
}
// A closed ring approximating a circle on the ground, for the radius outline.
export function circle(lat: number, lng: number, radiusKm: number, steps = 64): [number, number][] {
  const dLat = radiusKm / 111.32, dLng = dLat / Math.max(Math.cos(lat * Math.PI / 180), 0.01);
  return Array.from({length: steps + 1}, (_, i) => {
    const angle = 2 * Math.PI * i / steps;
    return [lng + dLng * Math.cos(angle), Math.max(-89.9, Math.min(89.9, lat + dLat * Math.sin(angle)))] as [number, number];
  });
}
