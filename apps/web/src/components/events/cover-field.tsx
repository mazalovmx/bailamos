'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {ImageUpload} from '../media/image-upload';
// The cover photo of the event: shown on top of its page and on its cards. Without one the school's logo is used.
export function CoverField({initialKey}: {initialKey?: string}) {
  const x = useTranslations('EventsX');
  const [key, setKey] = useState(initialKey || '');
  return <fieldset className="cover-field"><legend>{x('coverTitle')}</legend>
    <p className="field-note">{x('coverHint')}</p>
    <input type="hidden" name="imageKey" value={key}/>
    {key ? <div className="cover-preview"><img src={'/api/media/file/' + key} alt={x('coverAlt')} width={480} height={270}/>
      <button type="button" className="button secondary" onClick={() => setKey('')}>{x('coverRemove')}</button></div>
      : <ImageUpload target="eventmap" onUploaded={item => setKey(item.key)}/>}
  </fieldset>;
}
