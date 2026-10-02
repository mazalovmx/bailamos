'use client';
import {useLocale} from 'next-intl';
import {Combobox} from './combobox';
export type CityOption = {id: string; slug: string; name: string; localName?: string; countryCode?: string; timezone?: string};
// Drop-in replacement for a <select name="cityId">: submits the chosen city id under `name`.
// `onSelect` receives the full option (including the IANA timezone) or null when the choice is cleared.
// Names come back in the interface language; a city is found by its local, English, Spanish or Russian name and by slug.
// Pass `initialName` already localized: cityName(city, locale) from lib/catalogue/city-name.
export function CityAutocomplete({name, label, initialId, initialName, required, onSelect}: {
  name: string; label: string; initialId?: string; initialName?: string; required?: boolean; onSelect?: (city: CityOption | null) => void;
}) {
  const locale = useLocale();
  return <Combobox<CityOption> name={name} label={label} endpoint={'/api/catalogue/cities?locale=' + encodeURIComponent(locale)} required={required} onSelect={onSelect}
    initial={initialId ? [{id: initialId, slug: initialId, name: initialName || initialId}] : []}
    hint={city => [city.localName && city.localName !== city.name ? city.localName : '', city.countryCode].filter(Boolean).join(' · ')}/>;
}
