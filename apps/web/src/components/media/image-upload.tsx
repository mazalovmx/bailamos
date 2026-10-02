'use client';
import '../../app/styles/media.css';
import {useId, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import type {MediaDto} from '../../lib/media/dto';
export type UploadedImage = {id?: string; key: string; url: string; item?: MediaDto};
type Props = {
  target: 'event' | 'post' | 'avatar' | 'cover' | 'chat';
  targetId?: string;
  onUploaded?: (item: UploadedImage) => void;
  /** Mirrors the server limit (MEDIA_MAX_BYTES) for an early, friendly check; the server enforces the real one. */
  maxBytes?: number;
};
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
async function post(url: string, body: unknown) {
  const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GENERIC');
  return data;
}
// XMLHttpRequest because fetch still cannot report upload progress.
function put(url: string, headers: Record<string, string>, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));};
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let code = 'UPLOAD_FAILED';
      try {code = JSON.parse(xhr.responseText).error || code;} catch {/* storage answered with something else */}
      reject(new Error(code));
    };
    xhr.onerror = xhr.onabort = () => reject(new Error('UPLOAD_FAILED'));
    xhr.send(file);
  });
}
/** The three upload steps (ticket, PUT, verification) for callers with their own form, such as the chat composer. */
export async function uploadImage(file: File, target: Props['target'], targetId?: string, alt?: string, onProgress: (percent: number) => void = () => {}, onStored: () => void = () => {}) {
  const ticket = await post('/api/media/uploads', {target, targetId, mime: file.type, size: file.size});
  await put(ticket.uploadUrl, ticket.headers || {}, file, onProgress);
  onStored();
  return await post('/api/media/uploads/complete', {key: ticket.key, alt: alt || undefined}) as UploadedImage;
}
export const IMAGE_TYPES = TYPES;
export function ImageUpload({target, targetId, onUploaded, maxBytes = 10 * 1024 * 1024}: Props) {
  const t = useTranslations('Media'), uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null), [alt, setAlt] = useState('');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'processing' | 'done'>('idle');
  const [percent, setPercent] = useState(0), [error, setError] = useState('');
  const busy = phase === 'uploading' || phase === 'processing';
  const megabytes = Math.floor(maxBytes / 1024 / 1024);
  function choose(next: File | null) {
    setError(''); setPhase('idle'); setFile(null);
    if (!next) return;
    if (!TYPES.includes(next.type)) return setError('MEDIA_TYPE');
    if (next.size > maxBytes) return setError('MEDIA_TOO_LARGE');
    setFile(next);
  }
  async function upload() {
    if (!file || busy) return;
    setError(''); setPercent(0); setPhase('uploading');
    try {
      const done = await uploadImage(file, target, targetId, alt.trim(), setPercent, () => setPhase('processing'));
      setPhase('done'); setFile(null); setAlt('');
      if (input.current) input.current.value = '';
      onUploaded?.(done);
    } catch (failure) {
      setPhase('idle');
      setError(failure instanceof Error ? failure.message : 'GENERIC');
    }
  }
  return <div className="media-upload">
    <label htmlFor={uid + 'file'}>{t('uploadLabel')}
      <input ref={input} id={uid + 'file'} type="file" accept={TYPES.join(',')} disabled={busy} aria-describedby={uid + 'hint'}
        onChange={event => choose(event.target.files?.[0] || null)}/>
      <small id={uid + 'hint'}>{t('uploadHint', {size: megabytes})}</small>
    </label>
    <label htmlFor={uid + 'alt'}>{t('altLabel')}
      <input id={uid + 'alt'} type="text" value={alt} maxLength={300} disabled={busy} aria-describedby={uid + 'althint'}
        onChange={event => setAlt(event.target.value)}/>
      <small id={uid + 'althint'}>{t('altHint')}</small>
    </label>
    {busy && <progress className="media-progress" max={100} value={phase === 'processing' ? undefined : percent} aria-label={t('progressLabel')}/>}
    <p className="media-status" role="status" aria-live="polite">
      {phase === 'uploading' ? t('uploading', {percent}) : phase === 'processing' ? t('processing') : phase === 'done' ? t('uploaded') : ''}
    </p>
    {error && <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
    <button type="button" className="button" disabled={!file || busy} onClick={upload}>{t(busy ? 'working' : 'upload')}</button>
  </div>;
}
