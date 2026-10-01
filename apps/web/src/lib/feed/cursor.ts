// Pure part of the personal feed: item shapes, ordering, the cursor. No database access here.
import type {Variants} from '../media/url';
export type FeedKind = 'event' | 'post' | 'news';
type Base = {id: string; /** ISO time the item entered the stream. */ at: string};
export type FeedEvent = Base & {kind: 'event'; slug: string; title: string; eventKind: string; startsAt: string; timezone: string; city: string; styles: string[]};
export type FeedPost = Base & {kind: 'post'; slug: string; title: string; excerpt: string | null; author: {handle: string; name: string};
  image: {sources: Variants; alt: string; width: number | null; height: number | null} | null};
export type FeedNews = Base & {kind: 'news'; url: string; title: string; summary: string | null; source: string; city: string | null};
export type FeedItem = FeedEvent | FeedPost | FeedNews;
export type Cursor = {at: number; kind: FeedKind; id: string};
const KINDS: FeedKind[] = ['event', 'news', 'post'];
export function encodeCursor(item: {at: string | number; kind: FeedKind; id: string}) {
  return Buffer.from((typeof item.at === 'number' ? item.at : Date.parse(item.at)) + '.' + item.kind + '.' + item.id).toString('base64url');
}
/** Null for a missing or malformed cursor: the feed then starts from the top instead of failing. */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const match = /^(\d{1,15})\.(event|news|post)\.([A-Za-z0-9_-]{1,64})$/.exec(Buffer.from(value, 'base64url').toString('utf8'));
  return match ? {at: Number(match[1]), kind: match[2] as FeedKind, id: match[3]} : null;
}
const text = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Newest first; at the same instant: posts, then news, then events; then by id, descending. A total order, so paging is stable. */
export function compareFeed(a: {at: string | number; kind: FeedKind; id: string}, b: {at: string | number; kind: FeedKind; id: string}) {
  const ta = typeof a.at === 'number' ? a.at : Date.parse(a.at), tb = typeof b.at === 'number' ? b.at : Date.parse(b.at);
  return tb - ta || text(b.kind, a.kind) || text(b.id, a.id);
}
/**
 * The part of one source that comes after the cursor, as a Prisma filter over its time column and id.
 * Same kind: strictly older, or the same instant with a smaller id. Other kinds: the same instant still counts
 * for kinds that sort after the cursor's kind, and does not for kinds that sort before it.
 */
export function afterCursor(cursor: Cursor | null, kind: FeedKind, field: string): Record<string, unknown> {
  if (!cursor) return {};
  const at = new Date(cursor.at);
  if (kind === cursor.kind) return {OR: [{[field]: {lt: at}}, {[field]: at, id: {lt: cursor.id}}]};
  return {[field]: KINDS.indexOf(kind) < KINDS.indexOf(cursor.kind) ? {lte: at} : {lt: at}};
}
/** Merges per-source lists (each already limited to `limit + 1`, newest first) into one page. */
export function mergeFeed(lists: FeedItem[][], limit: number): {items: FeedItem[]; nextCursor: string | null} {
  const all = lists.flat().sort(compareFeed), items = all.slice(0, limit);
  return {items, nextCursor: all.length > limit && items.length ? encodeCursor(items[items.length - 1]) : null};
}
