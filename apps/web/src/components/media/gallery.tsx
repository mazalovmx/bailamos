import '../../app/styles/media.css';
import type {ReactNode} from 'react';
import {useTranslations} from 'next-intl';
import type {MediaDto} from '../../lib/media/dto';
import {InstagramEmbed} from './instagram-embed';
import {Picture} from './picture';
/** Grid of uploaded pictures and Instagram cards. `controls` adds per-item management UI (client side only). */
export function MediaGallery({items, controls}: {items: MediaDto[]; controls?: (item: MediaDto) => ReactNode}) {
  const t = useTranslations('Media');
  if (!items.length) return null;
  return <ul className="media-grid">
    {items.map(item => <li key={item.id} className={'media-tile media-' + item.kind}>
      {item.kind === 'upload'
        ? <Picture sources={item.sources} alt={item.alt || t('photoAltFallback')} width={item.width} height={item.height}
            sizes="(max-width: 520px) 100vw, (max-width: 900px) 50vw, 400px"/>
        : <InstagramEmbed permalink={item.permalink || ''} meta={item.meta}/>}
      {controls?.(item)}
    </li>)}
  </ul>;
}
