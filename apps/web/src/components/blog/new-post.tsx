'use client';
import '../../app/styles/blog.css';
import {useId, useState} from 'react';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
export type Publisher = {id: string; name: string};
/**
 * Starts a draft and opens the editor. The draft is created by an explicit action, never by merely opening a page.
 * `publishers` is the author's own profile followed by the schools the author manages; with more than one, the author
 * chooses in whose name the post is published.
 */
export function NewPost({publishers = []}: {publishers?: Publisher[]}) {
  const t = useTranslations('Blog'), locale = useLocale(), router = useRouter(), uid = useId();
  const [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [publisher, setPublisher] = useState(publishers[0]?.id || '');
  async function create() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/posts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: title.trim(), ...(publisher ? {profileId: publisher} : {})})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'GENERIC');
      router.push('/' + locale + '/posts/' + data.id + '/edit');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'GENERIC'); setBusy(false);
    }
  }
  return <form className="post-editor" onSubmit={event => {event.preventDefault(); void create();}}>
    <label htmlFor={uid}>{t('titleLabel')}
      <input id={uid} type="text" value={title} maxLength={200} aria-describedby={uid + 'hint'} onChange={event => setTitle(event.target.value)}/>
      <small id={uid + 'hint'}>{t('newTitleHint')}</small>
    </label>
    {publishers.length > 1 && <label htmlFor={uid + 'by'}>{t('publishedByLabel')}
      <select id={uid + 'by'} value={publisher} aria-describedby={uid + 'byhint'} onChange={event => setPublisher(event.target.value)}>
        {publishers.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      <small id={uid + 'byhint'}>{t('publishedByHint')}</small>
    </label>}
    {error && <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
    <div className="post-actions"><button type="submit" className="button" disabled={busy}>{t(busy ? 'working' : 'startWriting')}</button></div>
  </form>;
}
