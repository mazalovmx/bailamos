// Privacy helpers: exact profile coordinates never leave the server.
const STEP = 0.015; // degrees of latitude, about 1.7 km
const round = (value: number, digits: number) => Number(value.toFixed(digits));
// Snaps a point to a grid of roughly 1.7 km cells, so that a home address cannot be recovered.
export function coarsen(lat: number, lng: number): {lat: number; lng: number} {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RangeError('Coordinates out of range');
  const gridLat = Math.max(-90, Math.min(90, Math.round(lat / STEP) * STEP));
  // Meridians converge towards the poles: widen the longitude step to keep the cell about as wide as it is tall.
  const lngStep = Math.min(STEP / Math.max(Math.cos(gridLat * Math.PI / 180), 0.01), 360);
  let gridLng = Math.round(lng / lngStep) * lngStep;
  if (gridLng > 180) gridLng -= lngStep;
  if (gridLng < -180) gridLng += lngStep;
  return {lat: round(gridLat, 4), lng: round(gridLng, 4)};
}
type LocatedProfile = {district?: string | null; city?: {id?: string; slug?: string; name: string} | null; lat?: number | null; lng?: number | null};
export type PublicLocation = {city: {id?: string; slug?: string; name: string} | null; district: string | null};
// The only location a profile may expose publicly: city and district, never lat/lng.
export function publicLocation(profile: LocatedProfile): PublicLocation {
  const city = profile.city ? {
    ...(profile.city.id ? {id: profile.city.id} : {}), ...(profile.city.slug ? {slug: profile.city.slug} : {}), name: profile.city.name
  } : null;
  return {city, district: profile.district?.trim() || null};
}
// Great-circle distance in metres.
export function haversine(a: {lat: number; lng: number}, b: {lat: number; lng: number}): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
