import {createHash} from 'node:crypto';
export type RssItem = {title: string; link: string; description?: string | null; publishedAt: Date; author?: string; image?: string};
export type RssChannel = {title: string; link: string; self: string; description: string; language?: string; items: RssItem[]};
// Characters XML 1.0 cannot carry at all (most C0 controls, lone surrogates, U+FFFE/U+FFFF) are dropped before escaping.
const c = String.fromCharCode;
// Built from character codes so the source itself holds no control characters.
const INVALID = new RegExp('[' + c(0) + '-' + c(8) + c(11) + c(12) + c(14) + '-' + c(31) + c(0xFFFE) + c(0xFFFF) + ']|[' + c(0xD800) + '-' + c(0xDBFF) + '](?![' + c(0xDC00) + '-' + c(0xDFFF) + '])|(?<![' + c(0xD800) + '-' + c(0xDBFF) + '])[' + c(0xDC00) + '-' + c(0xDFFF) + ']', 'g');
const ENTITIES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'};
export const xmlEscape = (value: string) => value.replace(INVALID, '').replace(/[&<>"']/g, char => ENTITIES[char]);
const tag = (name: string, value: string) => '<' + name + '>' + xmlEscape(value) + '</' + name + '>';
/** RSS 2.0 with an atom:link to itself. Every value is escaped; links must already be absolute. */
export function buildRss(channel: RssChannel) {
  const newest = channel.items.reduce((max, item) => Math.max(max, item.publishedAt.getTime()), 0);
  const items = channel.items.map(item => '<item>' + tag('title', item.title) + tag('link', item.link) +
    '<guid isPermaLink="true">' + xmlEscape(item.link) + '</guid>' + tag('pubDate', item.publishedAt.toUTCString()) +
    (item.author ? tag('dc:creator', item.author) : '') + (item.description ? tag('description', item.description) : '') +
    (item.image ? '<enclosure url="' + xmlEscape(item.image) + '" type="image/webp" length="0"/>' : '') + '</item>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>' +
    tag('title', channel.title) + tag('link', channel.link) + tag('description', channel.description) +
    (channel.language ? tag('language', channel.language) : '') +
    '<atom:link href="' + xmlEscape(channel.self) + '" rel="self" type="application/rss+xml"/>' +
    (newest ? tag('lastBuildDate', new Date(newest).toUTCString()) : '') + tag('ttl', '60') +
    items.join('') + '</channel></rss>\n';
}
export const etagOf = (body: string) => '"' + createHash('sha1').update(body).digest('base64url') + '"';
/** Answers 304 when the client already holds this exact body (If-None-Match), otherwise the feed with validators. */
export function rssResponse(request: Request, body: string, lastModified: Date | null, maxAge = 900) {
  const etag = etagOf(body);
  const shared: Record<string, string> = {ETag: etag, 'Cache-Control': 'public, max-age=' + maxAge + ', stale-while-revalidate=3600',
    ...(lastModified ? {'Last-Modified': lastModified.toUTCString()} : {})};
  const wanted = request.headers.get('if-none-match');
  const since = Date.parse(request.headers.get('if-modified-since') || '');
  const fresh = wanted ? wanted.split(',').map(value => value.trim().replace(/^W\//, '')).some(value => value === etag || value === '*') :
    !!lastModified && Number.isFinite(since) && Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
  if (fresh) return new Response(null, {status: 304, headers: shared});
  return new Response(body, {headers: {'Content-Type': 'application/rss+xml; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...shared}});
}
