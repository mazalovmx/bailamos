import {INSTAGRAM_PERMALINK, safeHref} from './nodes';
// Stored TipTap JSON → an HTML string, for feed readers (RSS content:encoded). The page itself never uses this: it
// renders React elements. Same rules as the page renderer: only the elements listed here can appear, every text and
// attribute value is escaped, every link is checked again, unknown nodes are skipped.
export const FEED_LINK_REL = 'nofollow ugc';
export type HtmlOptions = {
  /** Absolute URL of an uploaded photo; an image is left out when it returns null. */
  imageUrl: (storageKey: string) => string | null;
  /** Stored card data of the Instagram blocks, by permalink. */
  embeds?: ReadonlyMap<string, {author?: string; title?: string}>;
};
type Node = {type?: unknown; text?: unknown; attrs?: Record<string, unknown>; marks?: unknown; content?: unknown};
const ENTITIES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const htmlEscape = (value: string) => value.replace(/[&<>"']/g, char => ENTITIES[char]);
const str = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const num = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000 ? value : null;
const children = (node: Node): Node[] => Array.isArray(node.content) ? node.content.filter(child => child && typeof child === 'object') : [];
const el = (tag: string, inner: string, attrs = '') => '<' + tag + attrs + '>' + inner + '</' + tag + '>';
const link = (href: string, inner: string) => '<a href="' + htmlEscape(href) + '" rel="' + FEED_LINK_REL + '">' + inner + '</a>';
function inline(node: Node): string {
  if (node.type === 'hardBreak') return '<br/>';
  if (node.type !== 'text' || typeof node.text !== 'string') return '';
  let out = htmlEscape(node.text);
  const marks = Array.isArray(node.marks) ? node.marks as Node[] : [];
  if (marks.some(mark => mark?.type === 'italic')) out = el('em', out);
  if (marks.some(mark => mark?.type === 'bold')) out = el('strong', out);
  const href = safeHref(marks.find(mark => mark?.type === 'link')?.attrs?.href);
  return href ? link(href, out) : out;
}
function block(node: Node, options: HtmlOptions, depth: number): string {
  if (depth > 14) return '';
  const inlines = () => children(node).map(inline).join(''), blocks = () => children(node).map(child => block(child, options, depth + 1)).join('');
  const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
  switch (node.type) {
    case 'paragraph': return el('p', inlines());
    case 'heading': return el(attrs.level === 3 ? 'h3' : 'h2', inlines());
    case 'bulletList': return el('ul', blocks());
    case 'orderedList': return el('ol', blocks(), num(attrs.start) ? ' start="' + num(attrs.start) + '"' : '');
    case 'listItem': return el('li', blocks());
    case 'blockquote': return el('blockquote', blocks());
    case 'image': {
      const key = str(attrs.storageKey), src = key ? safeHref(options.imageUrl(key)) : null;
      if (!src) return '';
      const size = (num(attrs.width) ? ' width="' + num(attrs.width) + '"' : '') + (num(attrs.height) ? ' height="' + num(attrs.height) + '"' : '');
      return el('figure', '<img src="' + htmlEscape(src) + '" alt="' + htmlEscape(str(attrs.alt) || '') + '"' + size + '/>');
    }
    case 'instagram': {
      const permalink = str(attrs.permalink);
      if (!permalink || !INSTAGRAM_PERMALINK.test(permalink)) return '';
      const meta = options.embeds?.get(permalink) ?? {author: str(attrs.author), title: str(attrs.title)};
      const label = ['Instagram', meta.author, meta.title?.slice(0, 180)].filter(Boolean).join(' · ');
      return el('p', link(permalink, htmlEscape(label)));
    }
    default: return '';
  }
}
export function contentHtml(doc: unknown, options: HtmlOptions): string {
  if (!doc || typeof doc !== 'object' || (doc as Node).type !== 'doc') return '';
  return children(doc as Node).map(node => block(node, options, 0)).join('');
}
