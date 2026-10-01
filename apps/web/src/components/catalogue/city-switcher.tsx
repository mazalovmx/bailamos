'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {CityAutocomplete} from './city-autocomplete';
import '../../app/styles/catalogue.css';
// Keep in sync with CITY_COOKIE in lib/catalogue/current-city.ts (that module is server-only).
const COOKIE = 'city';
export function setCityCookie(slug: string | null) {
  document.cookie = COOKIE + '=' + (slug ? encodeURIComponent(slug) : '') + '; Path=/; Max-Age=' + (slug ? 31536000 : 0) + '; SameSite=Lax'
    + (window.location.protocol === 'https:' ? '; Secure' : '');
}
// Lets a visitor pick "their" city. `current` comes from currentCity() on the server; the choice is stored for a year.
export function CitySwitcher({current}: {current?: {slug: string; name: string} | null}) {
  const t = useTranslations('Catalogue'), router = useRouter();
  const [version, setVersion] = useState(0);
  function change(slug: string | null) {setCityCookie(slug); setVersion(value => value + 1); router.refresh();}
  return <section className="city-switcher" aria-label={t('yourCity')}>
    <p role="status">{current ? t('currentCity', {name: current.name}) : t('noCurrentCity')}</p>
    <CityAutocomplete key={version} name="city-switcher" label={t(current ? 'changeCity' : 'chooseCity')} onSelect={city => {if (city) change(city.slug);}}/>
    {current && <div className="city-switcher-actions"><button type="button" className="link-button" onClick={() => change(null)}>{t('clearCity')}</button></div>}
  </section>;
}
// "Make this my city" on a city page.
export function UseCityButton({slug, active}: {slug: string; active: boolean}) {
  const t = useTranslations('Catalogue'), router = useRouter();
  return <button type="button" className="button secondary" aria-pressed={active} onClick={() => {setCityCookie(active ? null : slug); router.refresh();}}>
    {t(active ? 'isMyCity' : 'makeMyCity')}</button>;
}
