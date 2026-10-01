import '../../app/styles/blog.css';
import {renderContent, type ImageProps} from '../../lib/blog/render';
import {InstagramEmbed} from '../media/instagram-embed';
import {Picture} from '../media/picture';
const PostImage = ({storageKey, alt, width, height}: ImageProps) =>
  <Picture storageKey={storageKey} alt={alt} width={width} height={height} sizes="(max-width: 800px) 100vw, 760px"/>;
/** The body of a post, rendered on the server from stored TipTap JSON through our own renderer — no HTML injection. */
export function PostBody({content}: {content: unknown}) {
  return <div className="post-body">{renderContent(content, {Image: PostImage, Instagram: InstagramEmbed})}</div>;
}
