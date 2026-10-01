import {load} from 'cheerio';
import {DateTime} from 'luxon';
// Everything that comes from a feed is untrusted: tags are dropped, entities decoded, control characters removed and the
// length capped. The result is plain text and is never rendered as HTML.
function strip(html: string) {
  // Block boundaries become line breaks, so paragraphs survive as lines.
  const $ = load(html.replace(/<(br|\/?(p|div|li|tr|h[1-6]))\b[^>]*>/gi, '\n$&'), null, false);
  $('script,style,noscript,template,iframe,object,svg,head').remove();
  return $.root().text();
}
export function plain(value: unknown, max = 500, multiline = false): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value).slice(0, 200_000);
  // Twice: feeds often carry entity-encoded markup ("&lt;b&gt;") that only becomes a tag after the first decode.
  for (let pass = 0; pass < 2 && /[<&]/.test(text); pass++) text = strip(text);
  // Control and invisible formatting characters go; line breaks and tabs are whitespace and handled below.
  text = text.replace(/[<>]/g, '').replace(/(?![\n\r\t])\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}/gu, '');
  text = multiline
    ? text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : text.replace(/\s+/g, ' ').trim();
  return text.length > max ? Array.from(text).slice(0, max).join('').trim() : text;
}
// Absolute http(s) address or nothing. Credentials are refused, relative links are resolved against the feed.
export function safeUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return undefined;
  try {
    const url = new URL(value.trim(), base);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    return url.toString();
  } catch {return undefined;}
}
export const STAMP = "yyyy-MM-dd'T'HH:mm";
export type When = {instant?: Date; local?: string; allDay?: boolean};
// Reads a date as written in a feed: with an offset it is an instant, without one a wall-clock time whose zone is decided later.
export function parseWhen(value: unknown): When {
  if (typeof value !== 'string') return {};
  const text = value.trim().slice(0, 64);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return DateTime.fromISO(text, {zone: 'UTC'}).isValid ? {local: text + 'T00:00', allDay: true} : {};
  if (/^\d{4}-?\d{2}-?\d{2}[T ]\d{2}/.test(text)) {
    const iso = text.replace(' ', 'T'), parsed = DateTime.fromISO(iso, {zone: 'UTC', setZone: true});
    if (!parsed.isValid) return {};
    return /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(iso) ? {instant: parsed.toJSDate()} : {local: parsed.toFormat(STAMP)};
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? {} : {instant: new Date(time)};
}
export function coordinate(value: unknown, limit: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : undefined;
}
