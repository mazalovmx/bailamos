'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import '../../app/styles/catalogue.css';
export type ComboOption = {id: string; name: string; slug?: string};
// Editable combobox with list autocomplete (WAI-ARIA 1.2 pattern). The chosen id travels in a hidden input named `name`,
// so the component drops into any <form>; with `multiple` there is one hidden input per chosen item (FormData.getAll(name)).
export function Combobox<T extends ComboOption>({name, label, endpoint, initial = [], required, multiple, hint, onSelect}: {
  name: string; label: string; endpoint: string; initial?: T[]; required?: boolean; multiple?: boolean;
  hint?: (item: T) => string | null | undefined; onSelect?: (item: T | null) => void;
}) {
  const t = useTranslations('Catalogue'), uid = useId(), inputId = uid + 'input', listId = uid + 'list';
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<T[]>(multiple ? initial : initial.slice(0,1));
  const [text, setText] = useState(multiple ? '' : initial[0]?.name || '');
  const [options, setOptions] = useState<T[]>([]), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const pending = !multiple && !!text.trim() && !selected.length;
  const visible = options.filter(option => !multiple || !selected.some(item => item.id === option.id));
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState('loading');
      try {
        const response = await fetch(endpoint + '?q=' + encodeURIComponent(text.trim()), {signal: controller.signal});
        if (!response.ok) throw new Error('FAILED');
        setOptions((await response.json()).items);
        setActive(-1);
        setState('ready');
      } catch (error) {if (!(error instanceof DOMException && error.name === 'AbortError')) setState('failed');}
    }, 150);
    return () => {clearTimeout(timer); controller.abort();};
  }, [open, text, endpoint]);
  // Typed text that was never picked from the list must not be submitted as if it were a choice.
  useEffect(() => {input.current?.setCustomValidity(pending ? t('chooseFromList') : '');}, [pending, t]);
  function choose(item: T) {
    if (multiple) {setSelected(current => [...current, item]); setText('');}
    else {setSelected([item]); setText(item.name);}
    setOpen(false); setActive(-1); onSelect?.(item);
  }
  function remove(id: string) {setSelected(current => current.filter(item => item.id !== id)); input.current?.focus();}
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {setOpen(true); return;}
      if (visible.length) setActive(current => event.key === 'ArrowDown' ? (current + 1) % visible.length : (current <= 0 ? visible.length : current) - 1);
    } else if (event.key === 'Enter' && open && visible[active]) {event.preventDefault(); choose(visible[active]);}
    else if (event.key === 'Escape') {
      if (open) {event.preventDefault(); setOpen(false); setActive(-1);}
      else if (text) {setText(''); if (!multiple && selected.length) {setSelected([]); onSelect?.(null);}}
    } else if (event.key === 'Backspace' && multiple && !text && selected.length) setSelected(current => current.slice(0,-1));
  }
  const status = !open ? '' : state === 'failed' ? t('loadFailed') : state === 'ready' ? (visible.length ? t('resultsCount', {count: visible.length}) : t('noResults')) : '';
  return <div className="combobox">
    <label htmlFor={inputId}>{label}</label>
    {multiple && selected.length > 0 && <ul className="combobox-chips" aria-label={t('selectedItems', {label})}>{selected.map(item =>
      <li key={item.id}><button type="button" onClick={() => remove(item.id)} aria-label={t('removeItem', {name: item.name})}>{item.name} <span aria-hidden="true">×</span></button></li>)}</ul>}
    <div className="combobox-control">
      <input ref={input} id={inputId} type="text" role="combobox" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={80}
        aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={uid + 'status'}
        aria-activedescendant={open && visible[active] ? uid + 'option' + active : undefined}
        required={!!required && !selected.length} placeholder={t('typeToSearch')} value={text}
        onChange={event => {
          setText(event.target.value); setOpen(true);
          if (!multiple && selected.length) {setSelected([]); onSelect?.(null);}
        }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => {setOpen(false); setActive(-1);}} onKeyDown={onKeyDown}/>
      <ul className="combobox-list" id={listId} role="listbox" aria-label={label} hidden={!open || !visible.length}>{visible.map((option, index) =>
        <li key={option.id} id={uid + 'option' + index} role="option" aria-selected={index === active}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
          <span>{option.name}</span>{hint?.(option) && <small>{hint(option)}</small>}
        </li>)}</ul>
    </div>
    <p id={uid + 'status'} role="status" className={open && (state === 'failed' || (state === 'ready' && !visible.length)) ? 'combobox-empty' : 'sr-only'}>{status}</p>
    {multiple ? selected.map(item => <input key={item.id} type="hidden" name={name} value={item.id}/>) : <input type="hidden" name={name} value={selected[0]?.id || ''}/>}
  </div>;
}
