'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {ImageUpload} from '../media/image-upload';
import {countWords, MAP_NOTE_WORDS} from '../../lib/events/map-note';
// What people see when they open the event on the map: one photo (the entrance, the sign on the door) and a short note.
export function MapCardFields({initialKey, initialNote}: {initialKey?: string; initialNote?: string}) {
  const x = useTranslations('EventsX');
  const [key, setKey] = useState(initialKey || ''), [note, setNote] = useState(initialNote || '');
  const left = MAP_NOTE_WORDS - countWords(note);
  return <fieldset className="map-card-fields"><legend>{x('mapCardTitle')}</legend>
    <p className="field-note">{x('mapCardHint')}</p>
    <input type="hidden" name="mapImageKey" value={key}/>
    {key ? <div className="map-card-preview"><img src={'/api/media/file/' + key} alt={x('mapImageAlt')} width={320} height={200}/>
      <button type="button" className="button secondary" onClick={() => setKey('')}>{x('mapImageRemove')}</button></div>
      : <ImageUpload target="eventmap" onUploaded={item => setKey(item.key)}/>}
    <label>{x('mapNoteLabel')}<textarea name="mapNote" rows={2} maxLength={300} value={note} onChange={event => setNote(event.target.value)}
      aria-describedby="map-note-count" aria-invalid={left < 0 || undefined} placeholder={x('mapNotePlaceholder')}/>
      <small id="map-note-count" className={left < 0 ? 'form-error' : undefined} aria-live="polite">{left >= 0 ? x('wordsLeft', {count: left}) : x('wordsOver', {count: -left})}</small></label>
  </fieldset>;
}
