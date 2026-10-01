// Browser geolocation, used only after an explicit "near me" action. The position is rounded to about a kilometre
// before it leaves the device, and the server neither stores nor logs it.
export type NearMe = {lat: number; lng: number; city: {id: string; slug: string; name: string; lat: number; lng: number} | null};
export async function nearMe(): Promise<NearMe> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('GEOLOCATION_UNAVAILABLE');
  const position = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(error.code === error.PERMISSION_DENIED ? 'GEOLOCATION_DENIED' : 'GEOLOCATION_UNAVAILABLE')),
      {enableHighAccuracy: false, timeout: 10000, maximumAge: 600000}));
  const lat = Number(position.coords.latitude.toFixed(2)), lng = Number(position.coords.longitude.toFixed(2));
  let city: NearMe['city'] = null;
  try {
    const response = await fetch('/api/geo/locate?lat=' + lat + '&lng=' + lng);
    if (response.ok) city = (await response.json()).city;
  } catch { /* the position alone is still useful */ }
  return {lat, lng, city};
}
