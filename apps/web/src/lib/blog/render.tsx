import {Fragment, type ComponentType, type ReactNode} from 'react';
import {INSTAGRAM_PERMALINK, safeHref} from './nodes';
// Stored TipTap JSON → React elements. No HTML strings anywhere: text goes in as text nodes, so React escapes it, and
// only the elements listed here can appear. The stored body was validated on save, but the renderer does not rely on
// that: unknown nodes are skipped and every link is checked again.
export type ImageProps = {storageKey: string; alt: string; width?: number | null; height?: number | null};
export type InstagramProps = {permalink: string; meta: {author?: string; title?: string; thumbnailUrl?: string}};
export type RenderComponents = {Image: ComponentType<ImageProps>; Instagram: ComponentType<InstagramProps>};
export const USER_LINK_REL = 'nofollow ugc noopener';
type Node = {type?: unknown; text?: unknown; attrs?: Record<string, unknown>; marks?: unknown; content?: unknown};
const str = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const children = (node: Node): Node[] => Array.isArray(node.content) ? node.content.filter(child => child && typeof child === 'object') : [];
function inline(node: Node, key: number): ReactNode {
  if (node.type === 'hardBreak') return <br key={key}/>;
  if (node.type !== 'text' || typeof node.text !== 'string') return null;
  let out: ReactNode = node.text;
  const marks = Array.isArray(node.marks) ? node.marks as Node[] : [];
  if (marks.some(mark => mark?.type === 'italic')) out = <em>{out}</em>;
  if (marks.some(mark => mark?.type === 'bold')) out = <strong>{out}</strong>;
  const href = safeHref(marks.find(mark => mark?.type === 'link')?.attrs?.href);
  if (href) out = <a href={href} rel={USER_LINK_REL}>{out}</a>;
  return <Fragment key={key}>{out}</Fragment>;
}
function block(node: Node, key: number, parts: RenderComponents, depth: number): ReactNode {
  if (depth > 14) return null;
  const inlines = () => children(node).map(inline), blocks = () => children(node).map((child, index) => block(child, index, parts, depth + 1));
  const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
  switch (node.type) {
    case 'paragraph': return <p key={key}>{inlines()}</p>;
    case 'heading': return attrs.level === 3 ? <h3 key={key}>{inlines()}</h3> : <h2 key={key}>{inlines()}</h2>;
    case 'bulletList': return <ul key={key}>{blocks()}</ul>;
    case 'orderedList': return <ol key={key} start={num(attrs.start) ?? undefined}>{blocks()}</ol>;
    case 'listItem': return <li key={key}>{blocks()}</li>;
    case 'blockquote': return <blockquote key={key}>{blocks()}</blockquote>;
    case 'image': {
      const storageKey = str(attrs.storageKey);
      return storageKey ? <figure key={key} className="post-figure">
        <parts.Image storageKey={storageKey} alt={str(attrs.alt) || ''} width={num(attrs.width)} height={num(attrs.height)}/></figure> : null;
    }
    case 'instagram': {
      const permalink = str(attrs.permalink);
      return permalink && INSTAGRAM_PERMALINK.test(permalink) ? <div key={key} className="post-embed">
        <parts.Instagram permalink={permalink} meta={{author: str(attrs.author), title: str(attrs.title), thumbnailUrl: str(attrs.thumbnailUrl)}}/></div> : null;
    }
    default: return null;
  }
}
export function renderContent(doc: unknown, parts: RenderComponents): ReactNode {
  if (!doc || typeof doc !== 'object' || (doc as Node).type !== 'doc') return null;
  return children(doc as Node).map((node, index) => block(node, index, parts, 0));
}
