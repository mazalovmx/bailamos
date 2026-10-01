'use client';
import '../../app/styles/media.css';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
type Props = {permalink: string; meta?: {author?: string; title?: string; thumbnailUrl?: string}};
const excerpt = (text: string, max = 180) => text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
/**
 * Our own card for an Instagram post, built from cached oEmbed fields. Meta's script and markup are never injected,
 * so the page works under a CSP without inline scripts. Without data — or when the remote thumbnail has expired —
 * the card degrades to a title and a link.
 */
export function InstagramEmbed({permalink, meta}: Props) {
  const t = useTranslations('Media');
  const [broken, setBroken] = useState(false);
  // Only canonical Instagram permalinks are ever linked, whatever reaches this component.
  const href = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/$/.test(permalink) ? permalink : 'https://www.instagram.com/';
  const author = meta?.author, title = meta?.title;
  const thumbnail = !broken && meta?.thumbnailUrl?.startsWith('https://') ? meta.thumbnailUrl : undefined;
  return <article className={'ig-card' + (thumbnail ? '' : ' ig-card-plain')}>
    {thumbnail && <img className="ig-thumb" src={thumbnail} alt={author ? t('thumbnailAlt', {author}) : t('thumbnailAltGeneric')}
      loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)}/>}
    <div className="ig-body">
      <p className="ig-author">{author ? t('instagramBy', {author}) : t('instagramPost')}</p>
      {title && <p className="ig-caption">{excerpt(title)}</p>}
      <a className="ig-link" href={href} target="_blank" rel="nofollow ugc noopener">
        {t('viewOnInstagram')}<span className="sr-only"> {author ? t('linkContext', {author}) : ''} {t('opensNewTab')}</span>
      </a>
    </div>
  </article>;
}
