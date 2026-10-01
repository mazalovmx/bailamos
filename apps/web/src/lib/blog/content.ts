import {z} from 'zod';
import {INSTAGRAM_PERMALINK, safeHref, walk, type Block, type PostDoc} from './nodes';
// Server-side schema of a post body. Strict on purpose: a node, mark or attribute that is not listed here is refused,
// so nothing the renderer does not know can ever be stored.
export class ContentError extends Error {
  constructor(public code: 'INVALID_CONTENT' | 'FOREIGN_MEDIA' | 'CONTENT_TOO_LARGE') {super(code);}
}
export const MAX_CONTENT_CHARS = 150_000;
const MAX_NODES = 4000, MAX_DEPTH = 12;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const storageKey = z.string().regex(/^img\/[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}$/);
const href = z.string().max(2000).refine(value => safeHref(value) !== null);
const side = z.number().int().positive().max(20000).nullable().optional();
const thumbnail = z.string().max(2000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname);
  } catch {return false;}
});
const mark = z.union([
  z.strictObject({type: z.literal('bold')}), z.strictObject({type: z.literal('italic')}),
  z.strictObject({type: z.literal('link'), attrs: z.strictObject({href})})
]);
const inline = z.union([
  z.strictObject({type: z.literal('text'), text: z.string().min(1).max(20000),
    marks: z.array(mark).max(3).refine(marks => new Set(marks.map(m => m.type)).size === marks.length).optional()}),
  z.strictObject({type: z.literal('hardBreak')})
]);
const inlines = z.array(inline).max(2000).optional();
const block: z.ZodType<Block> = z.lazy(() => z.union([
  z.strictObject({type: z.literal('paragraph'), content: inlines}),
  z.strictObject({type: z.literal('heading'), attrs: z.strictObject({level: z.union([z.literal(2), z.literal(3)])}), content: inlines}),
  z.strictObject({type: z.literal('bulletList'), content: z.array(listItem).min(1).max(500)}),
  z.strictObject({type: z.literal('orderedList'), attrs: z.strictObject({start: z.number().int().min(0).max(100000).optional()}).optional(),
    content: z.array(listItem).min(1).max(500)}),
  z.strictObject({type: z.literal('blockquote'), content: z.array(block).min(1).max(500)}),
  z.strictObject({type: z.literal('image'), attrs: z.strictObject({mediaId: id, storageKey, alt: z.string().trim().min(1).max(300), width: side, height: side})}),
  z.strictObject({type: z.literal('instagram'), attrs: z.strictObject({permalink: z.string().regex(INSTAGRAM_PERMALINK),
    author: z.string().trim().min(1).max(100).optional(), title: z.string().trim().min(1).max(500).optional(), thumbnailUrl: thumbnail.optional()})})
]));
const listItem = z.strictObject({type: z.literal('listItem'), content: z.array(block).min(1).max(100)});
const doc = z.strictObject({type: z.literal('doc'), content: z.array(block).max(2000)});
export type PostMedia = {storageKey: string | null; width: number | null; height: number | null};
/**
 * Validates a post body and returns the copy to store. `media` holds the uploaded MediaItems of this very post, by id:
 * an image node pointing anywhere else is refused, and its storage key and size are taken from the database, not from
 * the request.
 */
export function parseContent(input: unknown, media: ReadonlyMap<string, PostMedia>): PostDoc {
  let size = 0;
  try {size = JSON.stringify(input)?.length ?? 0;} catch {throw new ContentError('INVALID_CONTENT');}
  if (size > MAX_CONTENT_CHARS) throw new ContentError('CONTENT_TOO_LARGE');
  // Shape limits first, so a hostile document cannot make the schema recurse deeply.
  let nodes = 0, deepest = 0;
  const measure = (node: unknown, depth: number) => {
    nodes++; deepest = Math.max(deepest, depth);
    if (nodes > MAX_NODES || depth > MAX_DEPTH) return;
    const children = node && typeof node === 'object' ? (node as {content?: unknown}).content : undefined;
    if (Array.isArray(children)) for (const child of children) measure(child, depth + 1);
  };
  measure(input, 0);
  if (nodes > MAX_NODES || deepest > MAX_DEPTH) throw new ContentError('INVALID_CONTENT');
  const parsed = doc.safeParse(input);
  if (!parsed.success) throw new ContentError('INVALID_CONTENT');
  walk(parsed.data, node => {
    if (node.type !== 'image') return;
    const attrs = node.attrs as {mediaId: string; storageKey: string; width?: number | null; height?: number | null};
    const item = media.get(attrs.mediaId);
    if (!item?.storageKey) throw new ContentError('FOREIGN_MEDIA');
    attrs.storageKey = item.storageKey; attrs.width = item.width; attrs.height = item.height;
  });
  return parsed.data;
}
