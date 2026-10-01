'use client';
import {Combobox} from './combobox';
export type StyleOption = {id: string; slug: string; name: string; parentName?: string | null};
// Drop-in replacement for a <select name="styleId">: submits the chosen style id under `name`.
// With `multiple`, several styles can be chosen (one hidden input each); pre-fill those with `initialItems`.
export function StyleAutocomplete({name, label, initialId, initialName, initialItems, required, multiple, onSelect}: {
  name: string; label: string; initialId?: string; initialName?: string; initialItems?: {id: string; name: string}[];
  required?: boolean; multiple?: boolean; onSelect?: (style: StyleOption | null) => void;
}) {
  const initial = (initialItems || (initialId ? [{id: initialId, name: initialName || initialId}] : [])).map(item => ({slug: item.id, ...item}));
  return <Combobox<StyleOption> name={name} label={label} endpoint="/api/catalogue/styles" initial={initial} required={required} multiple={multiple}
    hint={style => style.parentName} onSelect={onSelect}/>;
}
