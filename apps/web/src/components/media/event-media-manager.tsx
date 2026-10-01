'use client';
import '../../app/styles/media.css';
import {useId, useState} from 'react';
import {useTranslations} from 'next-intl';
import type {MediaDto} from '../../lib/media/dto';
import {MediaGallery} from './gallery';
import {ImageUpload} from './image-upload';
async function call(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GENERIC');
  return data;
}
function ItemControls({item, onChange, onDelete, onError}: {
  item: MediaDto; onChange: (item: MediaDto) => void; onDelete: (id: string) => void; onError: (code: string) => void
}) {
  const t = useTranslations('Media'), uid = useId();
  const [alt, setAlt] = useState(item.alt || ''), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onError('');
    try {await action();} catch (failure) {onError(failure instanceof Error ? failure.message : 'GENERIC');} finally {setBusy(false);}
  };
  return <div className="media-controls">
    {item.kind === 'upload' && <form onSubmit={event => {event.preventDefault(); void run(async () => onChange((await call('PATCH', '/api/media/items', {id: item.id, alt})).item));}}>
      <label htmlFor={uid}>{t('altLabel')}
        <input id={uid} type="text" value={alt} maxLength={300} onChange={event => setAlt(event.target.value)}/>
      </label>
      <button className="button secondary" disabled={busy || alt.trim() === (item.alt || '')}>{t('saveAlt')}</button>
    </form>}
    {confirming
      ? <div className="media-confirm" role="group" aria-label={t('deleteConfirm')}>
          <span>{t('deleteConfirm')}</span>
          <button type="button" className="button secondary media-danger" disabled={busy}
            onClick={() => run(async () => {await call('DELETE', '/api/media/items?id=' + encodeURIComponent(item.id)); onDelete(item.id);})}>{t('deleteYes')}</button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>{t('cancel')}</button>
        </div>
      : <button type="button" className="button secondary" onClick={() => setConfirming(true)}>
          {t('delete')}<span className="sr-only"> — {item.kind === 'upload' ? item.alt || t('photoAltFallback') : item.meta?.author ? t('instagramBy', {author: item.meta.author}) : t('instagramPost')}</span>
        </button>}
  </div>;
}
/** Organizer tools for event media: upload a photo, attach an Instagram post by link, edit alt text, delete. */
export function EventMediaManager({eventId, initial, maxBytes}: {eventId: string; initial: MediaDto[]; maxBytes?: number}) {
  const t = useTranslations('Media'), uid = useId();
  const [items, setItems] = useState(initial);
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [linkError, setLinkError] = useState(''), [status, setStatus] = useState('');
  const add = (item?: MediaDto) => {if (item) setItems(list => list.some(existing => existing.id === item.id) ? list : [...list, item]);};
  const message = (code: string) => t.has('error_' + code) ? t('error_' + code) : t('error_GENERIC');
  return <div className="media-manager">
    {items.length ? <MediaGallery items={items} controls={item => <ItemControls item={item} onError={setError}
      onChange={next => {setItems(list => list.map(existing => existing.id === next.id ? next : existing)); setStatus(t('saved'));}}
      onDelete={id => {setItems(list => list.filter(existing => existing.id !== id)); setStatus(t('deleted'));}}/>}/>
      : <p className="field-note">{t('galleryEmpty')}</p>}
    {error && <p role="alert" className="form-error">{message(error)}</p>}
    <p className="media-status" role="status" aria-live="polite">{status}</p>
    <div className="media-forms">
      <section aria-labelledby={uid + 'photo'}>
        <h3 id={uid + 'photo'}>{t('addPhotoTitle')}</h3>
        <ImageUpload target="event" targetId={eventId} maxBytes={maxBytes} onUploaded={uploaded => {add(uploaded.item); setStatus('');}}/>
      </section>
      <section aria-labelledby={uid + 'ig'}>
        <h3 id={uid + 'ig'}>{t('addInstagramTitle')}</h3>
        <form className="media-upload" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setLinkError(''); setStatus('');
          try {
            const result = await call('POST', '/api/media/items', {eventId, url});
            add(result.item); setUrl('');
            setStatus(t(result.status === 'degraded' ? 'embedDegradedNote' : 'instagramAdded'));
          } catch (failure) {setLinkError(failure instanceof Error ? failure.message : 'GENERIC');} finally {setBusy(false);}
        }}>
          <label htmlFor={uid + 'url'}>{t('instagramLabel')}
            <input id={uid + 'url'} type="url" inputMode="url" required maxLength={500} value={url} placeholder="https://www.instagram.com/p/…"
              aria-describedby={uid + 'urlhint'} aria-invalid={!!linkError} onChange={event => setUrl(event.target.value)}/>
            <small id={uid + 'urlhint'}>{t('instagramHint')}</small>
          </label>
          {linkError && <p role="alert" className="form-error">{message(linkError)}</p>}
          <button className="button" disabled={busy || !url.trim()}>{t(busy ? 'working' : 'addInstagram')}</button>
        </form>
      </section>
    </div>
  </div>;
}
