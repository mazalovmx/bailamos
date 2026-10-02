'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import type {Hit, SearchResult} from '../../lib/search/search';
import {searchTypes} from '../../lib/search/search-types';
import {Highlight} from './highlight';
import './search.css';
const MIN = 2, PER_TYPE = 3, DELAY = 250;
type State = 'idle' | 'loading' | 'ready' | 'failed' | 'limited';
// Site search field for the header: an editable combobox (WAI-ARIA 1.2) with instant suggestions from /api/search.
// Arrow keys walk the suggestions, Enter opens the highlighted one; Enter without a highlight (or the button) submits
// the plain GET form to /[locale]/search, so the field also works before hydration and without JavaScript.
export function SearchBox({initialQuery = ''}: {initialQuery?: string}) {
  const t = useTranslations('Search'), locale = useLocale(), router = useRouter(), uid = useId(), listId = uid + 'list';
  const [text, setText] = useState(initialQuery), [hits, setHits] = useState<Hit[]>([]), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [state, setState] = useState<State>('idle');
  const input = useRef<HTMLInputElement>(null);
  const query = text.trim(), long = [...query.replace(/[^\p{L}\p{N}]+/gu, '')].length >= MIN;
  useEffect(() => {
    if (!open || !long) {setHits([]); setState('idle'); return;}
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState('loading');
      try {
        const response = await fetch('/api/search?' + new URLSearchParams({q: query, type: 'all', limit: String(PER_TYPE), locale}), {signal: controller.signal});
        if (response.status === 429) {setHits([]); setState('limited'); return;}
        // A query the server finds too short simply has no suggestions.
        if (response.status === 400) {setHits([]); setState('idle'); return;}
        if (!response.ok) throw new Error('FAILED');
        const data = await response.json() as SearchResult;
        setHits(searchTypes.flatMap(type => data.groups[type]));
        setActive(-1);
        setState('ready');
      } catch (error) {if (!(error instanceof DOMException && error.name === 'AbortError')) {setHits([]); setState('failed');}}
    }, DELAY);
    return () => {clearTimeout(timer); controller.abort();};
  }, [open, long, query, locale]);
  const target = '/' + locale + '/search', all = target + '?' + new URLSearchParams({q: query});
  // The last option always leads to the full result page.
  const count = state === 'ready' ? hits.length + 1 : 0, shown = open && count > 0;
  function go(index: number) {
    setOpen(false); setActive(-1);
    router.push(index < hits.length ? '/' + locale + hits[index].path : all);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {setOpen(true); return;}
      if (count) setActive(current => event.key === 'ArrowDown' ? (current + 1) % count : (current <= 0 ? count : current) - 1);
    } else if (event.key === 'Enter' && shown && active >= 0) {event.preventDefault(); go(active);}
    else if (event.key === 'Escape') {
      if (open && (shown || state !== 'idle')) {event.preventDefault(); setOpen(false); setActive(-1);}
      else if (text) setText('');
    }
  }
  const message = !open ? '' : state === 'failed' ? t('error_GENERIC') : state === 'limited' ? t('error_RATE_LIMITED') : state === 'loading' ? t('loading')
    : state === 'ready' ? t('suggestionsCount', {count: hits.length}) : '';
  const meta = (hit: Hit) => [t('kind_' + hit.type), hit.type === 'events' && hit.startsAt
    ? new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeZone: hit.timezone}).format(new Date(hit.startsAt)) : '', hit.type === 'posts' ? hit.author : '', hit.city].filter(Boolean).join(' · ');
  return <form className="search-box" role="search" action={target} method="get" onSubmit={event => {if (!long) {event.preventDefault(); input.current?.focus();} else setOpen(false);}}>
    <div className="search-box-field">
      <input ref={input} type="text" name="q" role="combobox" inputMode="search" enterKeyHint="search" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100}
        aria-label={t('label')} aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" aria-describedby={uid + 'status'}
        aria-activedescendant={shown && active >= 0 ? uid + 'option' + active : undefined} placeholder={t('placeholder')} value={text}
        onChange={event => {setText(event.target.value); setOpen(true); setActive(-1);}} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onBlur={() => {setOpen(false); setActive(-1);}} onKeyDown={onKeyDown}/>
      <ul className="search-suggestions" id={listId} role="listbox" aria-label={t('label')} hidden={!shown}>
        {hits.map((hit, index) => <li key={hit.type + hit.id} id={uid + 'option' + index} role="option" aria-selected={index === active}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => go(index)}>
          <span><Highlight segments={hit.title}/></span><small>{meta(hit)}</small></li>)}
        {count > 0 && <li className="search-see-all" id={uid + 'option' + hits.length} role="option" aria-selected={active === hits.length}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(hits.length)} onClick={() => go(hits.length)}>{t('seeAll', {query})}</li>}
      </ul>
      <p id={uid + 'status'} role="status" aria-live="polite" className={open && (state === 'failed' || state === 'limited') ? 'search-box-status' : 'sr-only'}>{message}</p>
    </div>
    <button type="submit">{t('submit')}</button>
  </form>;
}
