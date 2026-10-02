'use client';
import {useEffect, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {EventForm} from '../forms';
type Options = {id: string; name: string; timezone?: string; lat?: number; lng?: number}[];
type Parsed = {parseId: string; cityId: string; fields: Record<string, string>; warnings: string[]; lowConfidence: boolean;
  notes: {artists: string[]; instagramUrls: string[]; unmatchedStyles: string[]; otherStyles: string[]; venueName: string | null; address: string | null}};
// Field names the parser can fill. "location" stands for the venue or the exact point.
const fieldOf = (name: string) => name === 'venueId' || name === 'lat' || name === 'lng' ? 'location' : name;
// Sets a form control the way a user would, so that React-controlled inputs notice the change.
function setControl(element: Element, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {bubbles: true}));
}
// New-event screen: paste an announcement, get the form pre-filled, review and correct it. The parser only suggests;
// saving still goes through the ordinary form and needs the organizer's explicit confirmation.
export function EventComposer({cities, styles, tags, schools, initial, parser}: {cities: Options; styles: Options; tags: Options; schools: Options; initial: Record<string, string>; parser: boolean}) {
  const x = useTranslations('EventsX');
  const [text, setText] = useState(''), [cityId, setCityId] = useState(initial.cityId || ''), [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null), [message, setMessage] = useState(''), [cleared, setCleared] = useState<string[]>([]);
  const form = useRef<HTMLDivElement>(null);
  const suggested = parsed ? [...new Set(Object.keys(parsed.fields).map(fieldOf))].filter(name => !cleared.includes(name)) : [];
  // Suggested fields are marked in the form itself so that it is obvious what came from the parser.
  useEffect(() => {
    const root = form.current;
    if (!root) return;
    root.querySelectorAll('.parse-suggested').forEach(element => element.classList.remove('parse-suggested'));
    for (const name of suggested) (name === 'location' ? root.querySelectorAll('.geo-event-location') : root.querySelectorAll('[name="' + name + '"]'))
      .forEach(element => element.classList.add('parse-suggested'));
  });
  async function parse() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/events/parse', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, cityId})});
      const data = await response.json();
      if (response.status === 429) {setMessage(x('error_PARSE_LIMIT')); return;}
      if (!response.ok || !data.parsed) {setMessage(x('parseFailed')); return;}
      setCleared([]); setParsed(data as Parsed); setMessage(x('parseDone', {count: Object.keys(data.fields).map(fieldOf).filter((name, index, all) => all.indexOf(name) === index).length}));
    } catch {setMessage(x('parseFailed'));} finally {setBusy(false);}
  }
  function clear(name: string) {
    const root = form.current;
    if (root) {
      if (name === 'location') {
        // Back to "no venue, no exact point": untick the custom point and reset the venue select.
        const toggle = root.querySelector<HTMLInputElement>('.geo-event-location input[type=checkbox]');
        if (toggle?.checked) toggle.click();
        root.querySelectorAll('.geo-event-location select').forEach(element => setControl(element, ''));
      } else root.querySelectorAll('[name="' + name + '"]').forEach(element => setControl(element, name === 'level' ? 'UNSPECIFIED' : ''));
    }
    setCleared(current => [...current, name]);
  }
  const notes = parsed?.notes;
  return <>
    {parser && <section className="parse-panel" aria-labelledby="parse-title"><h2 id="parse-title">{x('parseTitle')}</h2><p>{x('parseHint')}</p>
      <label>{x('parseCity')}<select value={cityId} onChange={event => setCityId(event.target.value)}><option value="">{x('parseChooseCity')}</option>
        {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
      <label>{x('parseLabel')}<textarea rows={6} maxLength={4000} value={text} onChange={event => setText(event.target.value)} placeholder={x('parsePlaceholder')}/></label>
      <button type="button" className="button secondary" disabled={busy || !cityId || text.trim().length < 10} onClick={parse}>{x(busy ? 'parseWorking' : 'parseButton')}</button>
      <p className="field-note">{x('parsePrivacy')}</p>
      <p role="status" aria-live="polite">{message}</p>
      {parsed && <div className="parse-review">
        {parsed.lowConfidence && <p className="notice" role="alert">{x('parseLow')}</p>}
        {parsed.warnings.map(code => <p className="notice" key={code}>{x('parseWarning_' + code)}</p>)}
        {suggested.length > 0 && <><h3>{x('parseSuggested')}</h3><ul className="parse-chips">{suggested.map(name => <li key={name}>
          <span>{x('parseField_' + name)}</span><button type="button" onClick={() => clear(name)}>{x('parseClear')}<span className="sr-only"> — {x('parseField_' + name)}</span></button></li>)}</ul></>}
        {notes && notes.unmatchedStyles.length > 0 && <p>{x('parseUnmatched', {styles: notes.unmatchedStyles.join(', ')})}</p>}
        {notes && notes.otherStyles.length > 0 && <p>{x('parseOtherStyles', {styles: notes.otherStyles.join(', ')})}</p>}
        {notes && (notes.venueName || notes.address) && <p>{x('parsePlace', {place: [notes.venueName, notes.address].filter(Boolean).join(', ')})}</p>}
        {notes && notes.artists.length > 0 && <p>{x('parseArtists', {names: notes.artists.join(', ')})}</p>}
        {notes && notes.instagramUrls.length > 0 && <p>{x('parseInstagram', {count: notes.instagramUrls.length})}</p>}
      </div>}
    </section>}
    {/* A fresh parse remounts the form with the suggested values; the organizer's later edits stay untouched. */}
    <div ref={form}><EventForm key={parsed?.parseId || 'manual'} cities={cities} styles={styles} tags={tags} schools={schools} parseId={parsed?.parseId}
      initial={parsed ? {...initial, cityId: parsed.cityId, ...parsed.fields} : initial}/></div>
  </>;
}
