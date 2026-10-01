import '../../app/styles/media.css';
import {variants, type Variants} from '../../lib/media/url';
type Props = {
  /** Text alternative; required. Pass "" only for purely decorative images. */
  alt: string;
  /** MediaItem.storageKey / Profile.avatarKey / Profile.coverKey. Use in server components. */
  storageKey?: string;
  /** Ready-made URLs from the server (MediaDto.sources). Use in client components. */
  sources?: Variants;
  /** Intrinsic size of the largest variant; reserves the space before the image loads. */
  width?: number | null;
  height?: number | null;
  sizes?: string;
  className?: string;
  /** Above-the-fold images load eagerly; everything else is lazy. */
  priority?: boolean;
};
export function Picture({alt, storageKey, sources, width, height, sizes = '(max-width: 600px) 100vw, 800px', className, priority = false}: Props) {
  const set = sources ?? (storageKey ? variants(storageKey, width) : null);
  if (!set) return null;
  return <picture className={'media-picture' + (className ? ' ' + className : '')}>
    <source type="image/avif" srcSet={set.avif} sizes={sizes}/>
    <source type="image/webp" srcSet={set.webp} sizes={sizes}/>
    <img src={set.src} alt={alt} width={width || undefined} height={height || undefined}
      loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : undefined}/>
  </picture>;
}
