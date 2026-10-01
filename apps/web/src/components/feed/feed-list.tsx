'use client';
import '../../app/styles/blog.css';
import {useState} from 'react';
import Link from 'next/link';
import {useLocale, useTranslations} from 'next-intl';
import type {FeedItem} from '../../lib/feed/cursor';
import {Picture} from '../media/picture';
const day = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeZone: 'UTC'}).format(new Date(iso));
const externalUrl = (value: string) => {
  try {const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;} catch {return null;}
};
function Item({item, locale}: {item: FeedItem; locale: string}) {
  const t = useTranslations('Feed'), app = useTranslations('App');
  if (item.kind === 'event') return <article className="feed-item feed-event">
    <p className="feed-kind">{t('kindEvent')} · {app.has('kind_' + item.eventKind) ? app('kind_' + item.eventKind) : item.eventKind}</p>
    <h2><Link href={'/' + locale + '/events/' + item.slug}>{item.title}</Link></h2>
    <p className="post-meta"><time dateTime={item.startsAt} suppressHydrationWarning>
      {new Intl.DateTimeFormat(locale, {dateStyle: 'full', timeStyle: 'short', timeZone: item.timezone}).format(new Date(item.startsAt))}</time> · {item.city}</p>
    {item.styles.length > 0 && <div className="tags">{item.styles.map(style => <span key={style}>{style}</span>)}</div>}
  </article>;
  if (item.kind === 'post') return <article className="feed-item feed-post">
    {item.image && <Picture className="post-card-image" sources={item.image.sources} alt={item.image.alt} width={item.image.width} height={item.image.height}
      sizes="(max-width: 600px) 100vw, 320px"/>}
    <div>
      <p className="feed-kind">{t('kindPost')}</p>
      <h2><Link href={'/' + locale + '/people/' + item.author.handle + '/posts/' + item.slug}>{item.title}</Link></h2>
      <p className="post-meta"><Link href={'/' + locale + '/people/' + item.author.handle}>{item.author.name}</Link> · <time dateTime={item.at} suppressHydrationWarning>{day(locale, item.at)}</time></p>
      {item.excerpt && <p>{item.excerpt}</p>}
    </div>
  </article>;
  const href = externalUrl(item.url);
  return <article className="feed-item feed-news">
    <p className="feed-kind">{t('kindNews')}{item.city ? ' · ' + item.city : ''}</p>
    <h2>{href ? <a href={href} target="_blank" rel="nofollow noopener noreferrer">{item.title}<span className="sr-only"> {t('opensNewTab')}</span></a> : item.title}</h2>
    <p className="post-meta">{item.source} · <time dateTime={item.at} suppressHydrationWarning>{day(locale, item.at)}</time></p>
    {item.summary && <p>{item.summary.length > 300 ? item.summary.slice(0, 300).trimEnd() + '…' : item.summary}</p>}
  </article>;
}
/** The stream itself: the first page comes from the server, later pages from GET /api/feed?cursor=. */
export function FeedList({initial, initialCursor}: {initial: FeedItem[]; initialCursor: string | null}) {
  const t = useTranslations('Feed'), locale = useLocale();
  const [items, setItems] = useState(initial), [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [announce, setAnnounce] = useState('');
  async function more() {
    if (!cursor || busy) return;
    setBusy(true); setError(false);
    try {
      const response = await fetch('/api/feed?cursor=' + encodeURIComponent(cursor));
      if (!response.ok) throw new Error('FEED');
      const page = await response.json() as {items: FeedItem[]; nextCursor: string | null};
      // The same item never appears twice, even if the stream changed between two requests.
      setItems(current => {
        const seen = new Set(current.map(item => item.kind + item.id));
        return [...current, ...page.items.filter(item => !seen.has(item.kind + item.id))];
      });
      setCursor(page.nextCursor);
      setAnnounce(t('loaded', {count: page.items.length}));
    } catch {setError(true);} finally {setBusy(false);}
  }
  if (!items.length) return <div className="empty"><p>{t('empty')}</p></div>;
  return <>
    <ol className="feed-list">{items.map(item => <li key={item.kind + item.id}><Item item={item} locale={locale}/></li>)}</ol>
    <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    {error && <p role="alert" className="form-error">{t('loadError')}</p>}
    {cursor ? <button type="button" className="button secondary feed-more" disabled={busy} onClick={() => void more()}>{t(busy ? 'loading' : 'loadMore')}</button> :
      <p className="field-note feed-end">{t('end')}</p>}
  </>;
}
