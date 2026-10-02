// Pure helpers over a post body (TipTap JSON). No Node, database or environment access: the editor imports this too.
export type Mark = {type: 'bold'} | {type: 'italic'} | {type: 'link'; attrs: {href: string}};
export type ImageAttrs = {mediaId: string; storageKey: string; alt: string; width?: number | null; height?: number | null};
export type InstagramAttrs = {permalink: string; author?: string; title?: string; thumbnailUrl?: string};
export type Inline = {type: 'text'; text: string; marks?: Mark[]} | {type: 'hardBreak'};
export type ListItem = {type: 'listItem'; content: Block[]};
export type Block =
  | {type: 'paragraph'; content?: Inline[]}
  | {type: 'heading'; attrs: {level: 2 | 3}; content?: Inline[]}
  | {type: 'bulletList'; content: ListItem[]}
  | {type: 'orderedList'; attrs?: {start?: number}; content: ListItem[]}
  | {type: 'blockquote'; content: Block[]}
  | {type: 'image'; attrs: ImageAttrs}
  | {type: 'instagram'; attrs: InstagramAttrs};
export type PostDoc = {type: 'doc'; content: Block[]};
export const emptyDoc = (): PostDoc => ({type: 'doc', content: [{type: 'paragraph'}]});
/** Attributes that are stored, per node or mark type. Everything else the editor emits (link target, list type…) is dropped. */
export const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  heading: ['level'], orderedList: ['start'], link: ['href'],
  image: ['mediaId', 'storageKey', 'alt', 'width', 'height'], instagram: ['permalink', 'author', 'title', 'thumbnailUrl']
};
export const INSTAGRAM_PERMALINK = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,64}\/$/;
/** The link target when it is an absolute http(s) or mailto URL without credentials; null for everything else. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000 || [...value.trim()].some(char => char.charCodeAt(0) <= 32)) return null;
  let url: URL;
  try {url = new URL(value.trim());} catch {return null;}
  if (url.protocol === 'mailto:') return url.href;
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null;
  return url.href;
}
type Loose = {type?: unknown; text?: unknown; attrs?: unknown; marks?: unknown; content?: unknown};
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function pickAttrs(type: unknown, attrs: unknown) {
  const allowed = typeof type === 'string' ? ALLOWED_ATTRS[type] : undefined;
  if (!allowed || !isObject(attrs)) return undefined;
  const entries = allowed.filter(name => attrs[name] !== undefined && attrs[name] !== null && attrs[name] !== '').map(name => [name, attrs[name]] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
/**
 * Brings editor output to the stored shape: only whitelisted attributes survive, and empty optional parts are omitted.
 * It does not judge the content — the server schema does — it only removes the noise TipTap adds.
 */
export function cleanContent(node: unknown, depth = 0): unknown {
  if (!isObject(node) || depth > 20) return node;
  const raw = node as Loose, out: Record<string, unknown> = {type: raw.type};
  if (raw.type === 'text') out.text = raw.text;
  const attrs = pickAttrs(raw.type, raw.attrs);
  if (attrs) out.attrs = attrs;
  if (Array.isArray(raw.marks) && raw.marks.length)
    out.marks = raw.marks.map(mark => isObject(mark) ? {type: mark.type, ...(pickAttrs(mark.type, mark.attrs) ? {attrs: pickAttrs(mark.type, mark.attrs)} : {})} : mark);
  if (Array.isArray(raw.content) && (raw.content.length || raw.type === 'doc')) out.content = raw.content.map(child => cleanContent(child, depth + 1));
  return out;
}
/** Visits every node of a stored body. Tolerates malformed input: the column is free-form JSON. */
export function walk(node: unknown, visit: (node: Record<string, unknown>) => void, depth = 0) {
  if (!isObject(node) || depth > 20) return;
  visit(node);
  if (Array.isArray(node.content)) for (const child of node.content) walk(child, visit, depth + 1);
}
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'image', 'instagram']);
export function plainText(doc: unknown, max = 100_000) {
  let text = '';
  walk(doc, node => {
    if (text.length > max) return;
    if (node.type === 'text' && typeof node.text === 'string') text += node.text;
    else if (node.type === 'hardBreak' || BLOCKS.has(String(node.type))) text += ' ';
  });
  return text.replace(/\s+/g, ' ').trim();
}
/** Plain-text summary cut at a word boundary. */
export function excerptOf(doc: unknown, max = 220) {
  const text = plainText(doc, max * 4);
  if (text.length <= max) return text;
  const cut = text.slice(0, max), space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}
export function imagesOf(doc: unknown): ImageAttrs[] {
  const found: ImageAttrs[] = [];
  walk(doc, node => {
    if (node.type !== 'image' || !isObject(node.attrs)) return;
    const {mediaId, storageKey, alt, width, height} = node.attrs;
    if (typeof mediaId === 'string' && typeof storageKey === 'string')
      found.push({mediaId, storageKey, alt: typeof alt === 'string' ? alt : '', width: typeof width === 'number' ? width : null, height: typeof height === 'number' ? height : null});
  });
  return found;
}
export const firstImage = (doc: unknown): ImageAttrs | null => imagesOf(doc)[0] || null;
/** True when the body has neither text nor media. */
export function isEmptyDoc(doc: unknown) {
  let media = false;
  walk(doc, node => {if (node.type === 'image' || node.type === 'instagram') media = true;});
  return !media && !plainText(doc, 10);
}
function without<T>(doc: T, drop: (node: Record<string, unknown>) => boolean): T {
  const strip = (node: unknown, depth: number): unknown => {
    if (!isObject(node) || !Array.isArray(node.content) || depth > 20) return node;
    return {...node, content: node.content.filter(child => !(isObject(child) && drop(child))).map(child => strip(child, depth + 1))};
  };
  return strip(doc, 0) as T;
}
/** A copy of the body without the image nodes whose MediaItem is listed (hidden by moderation, for instance). */
export function withoutImages<T>(doc: T, mediaIds: ReadonlySet<string>): T {
  return mediaIds.size ? without(doc, node => node.type === 'image' && isObject(node.attrs) && mediaIds.has(String(node.attrs.mediaId))) : doc;
}
/** A copy of the body without the Instagram blocks of the listed permalinks. */
export function withoutEmbeds<T>(doc: T, permalinks: ReadonlySet<string>): T {
  return permalinks.size ? without(doc, node => node.type === 'instagram' && isObject(node.attrs) && permalinks.has(String(node.attrs.permalink))) : doc;
}
/** Canonical permalinks of the Instagram blocks of a body, in document order, each once. */
export function embedsOf(doc: unknown): string[] {
  const found = new Set<string>();
  walk(doc, node => {
    if (node.type === 'instagram' && isObject(node.attrs) && typeof node.attrs.permalink === 'string' && INSTAGRAM_PERMALINK.test(node.attrs.permalink)) found.add(node.attrs.permalink);
  });
  return [...found];
}
