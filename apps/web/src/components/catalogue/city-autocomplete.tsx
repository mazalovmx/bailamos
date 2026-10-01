'use client';
import {Combobox} from './combobox';
export type CityOption = {id: string; slug: string; name: string; countryCode?: string; timezone?: string};
// Drop-in replacement for a <select name="cityId">: submits the chosen city id under `name`.
// `onSelect` receives the full option (including the IANA timezone) or null when the choice is cleared.
export function CityAutocomplete({name, label, initialId, initialName, required, onSelect}: {
  name: string; label: string; initialId?: string; initialName?: string; required?: boolean; onSelect?: (city: CityOption | null) => void;
}) {
  return <Combobox<CityOption> name={name} label={label} endpoint="/api/catalogue/cities" required={required} onSelect={onSelect}
    initial={initialId ? [{id: initialId, slug: initialId, name: initialName || initialId}] : []} hint={city => city.countryCode}/>;
}
