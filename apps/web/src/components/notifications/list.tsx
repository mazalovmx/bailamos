'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useState} from 'react';
import type {NotificationItem} from '../../lib/notifications/center';
import {announce, call, useNoteError} from './shared';
type Page = {items: NotificationItem[]; nextCursor: string | null; unread: number};
export function NotificationList({initial}: {initial: Page}) {
  const t = useTranslations('Notifications'), locale = useLocale(), errorText = useNoteError();
  const [items, setItems] = useState(initial.items), [cursor, setCursor] = useState(initial.nextCursor), [unread, setUnread] = useState(initial.unread);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Times are shown in the reader's own zone, which the server does not know: the <time> below tolerates the difference.
  const when = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'});
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try {await action();} catch (failure) {setError(failure instanceof Error ? failure.message : 'GENERIC');} finally {setBusy(false);}
  }
  const counted = (value: number) => {setUnread(value); announce(value);};
  const readOne = (id: string) => run(async () => {
    const result = await call('/api/notifications/read', 'POST', {id});
    setItems(list => list.map(item => item.id === id ? {...item, read: true} : item)); counted(result.unread);
  });
  const readAll = () => run(async () => {
    const result = await call('/api/notifications/read', 'POST', {all: true});
    setItems(list => list.map(item => ({...item, read: true}))); counted(result.unread);
  });
  const more = () => run(async () => {
    const page: Page = await call('/api/notifications?locale=' + locale + '&cursor=' + encodeURIComponent(cursor || ''));
    setItems(list => [...list, ...page.items.filter(item => !list.some(known => known.id === item.id))]); setCursor(page.nextCursor); counted(page.unread);
  });
  // Following a notification marks it as read; keepalive lets the request outlive the page change.
  const opened = (item: NotificationItem) => {
    if (item.read) return;
    void fetch('/api/notifications/read', {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: item.id})}).catch(() => undefined);
    announce(Math.max(0, unread - 1));
  };
  if (!items.length) return <div className="note-empty"><h2>{t('empty')}</h2><p>{t('emptyText')}</p></div>;
  return <>
    <div className="note-toolbar"><p role="status">{t('unreadSummary', {count: unread})}</p>
      <button type="button" className="button secondary" disabled={busy || !unread} onClick={readAll}>{t('markAllRead')}</button></div>
    {error && <p role="alert" className="form-error">{errorText(error)}</p>}
    <ul className="note-list">{items.map(item => <li key={item.id} className={item.read ? 'note-item' : 'note-item unread'}>
      <div className="note-text">
        <h2>{!item.read && <span className="note-dot"><span className="visually-hidden">{t('unread')}: </span></span>}
          {item.url ? <a href={item.url} onClick={() => opened(item)}>{item.title}</a> : item.title}</h2>
        {item.body && <p>{item.body}</p>}
        <time dateTime={item.createdAt} suppressHydrationWarning>{when.format(new Date(item.createdAt))}</time>
      </div>
      {!item.read && <button type="button" className="note-read" disabled={busy} onClick={() => readOne(item.id)}>{t('markRead')}</button>}
    </li>)}</ul>
    {cursor && <button type="button" className="button secondary" disabled={busy} onClick={more}>{t('loadMore')}</button>}
  </>;
}
