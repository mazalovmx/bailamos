import {cookies} from 'next/headers';
import {allCities, type CityOption} from './data';
// The visitor's chosen city lives in the "city" cookie (slug, 1 year, SameSite=Lax), written by components/catalogue/city-switcher.
export const CITY_COOKIE = 'city';
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Server only. Returns the slug from the cookie, or null when nothing (or something malformed) is stored.
export async function currentCitySlug(): Promise<string | null> {
  const value = (await cookies()).get(CITY_COOKIE)?.value;
  return value && slugPattern.test(value) ? value : null;
}
// Server only. Resolves the cookie to an existing city; a stale slug yields null.
export async function currentCity(): Promise<CityOption | null> {
  const slug = await currentCitySlug();
  return slug ? (await allCities()).find(city => city.slug === slug) || null : null;
}
