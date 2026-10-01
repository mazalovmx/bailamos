import Parser from 'rss-parser';
import {createHash} from 'node:crypto';
import {coordinate, parseWhen, plain, safeUrl} from './text';
import {MAX_ITEMS, type ParsedEvent, type ParsedNews} from './types';
// RSS 2.0 and Atom. News sources become NewsItems; event sources need a real event date, which plain RSS does not have,
// so only items carrying the RSS event module (ev:startdate), xCal (xcal:dtstart) or a W3C geo point are understood.
type Extra = {evStart?: string; evEnd?: string; evLocation?: string; xStart?: string; xEnd?: string; xLocation?: string;
  geoLat?: string; geoLong?: string; geoPoint?: string; summary?: string; id?: string};
const parser = new Parser<Record<string, unknown>, Extra>({customFields: {item: [
  ['ev:startdate', 'evStart'], ['ev:enddate', 'evEnd'], ['ev:location', 'evLocation'],
  ['xcal:dtstart', 'xStart'], ['xcal:dtend', 'xEnd'], ['xcal:location', 'xLocation'],
  ['geo:lat', 'geoLat'], ['geo:long', 'geoLong'], ['georss:point', 'geoPoint']]}});
const text = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' && '_' in value ? String((value as {_: unknown})._) : '';
async function entries(xml: string) {
  const feed = await parser.parseString(xml);
  return {items: (feed.items || []).slice(0, MAX_ITEMS), base: safeUrl(feed.link)};
}
export const SUMMARY_LENGTH = 300;
export async function parseNews(xml: string, now = new Date()): Promise<ParsedNews[]> {
  const {items, base} = await entries(xml), news = new Map<string, ParsedNews>();
  for (const item of items) {
    const url = safeUrl(item.link, base), title = plain(item.title, 200);
    if (!url || !title) continue;
    const published = new Date(item.isoDate || item.pubDate || '');
    // A feed cannot pin itself to the top of the news with a date in the future.
    const publishedAt = Number.isNaN(published.getTime()) || published > now ? now : published;
    const summary = plain(item.content || text(item.summary) || item.contentSnippet, SUMMARY_LENGTH);
    news.set(url, {url, title, summary: summary || undefined, publishedAt});
  }
  return [...news.values()];
}
export async function parseRssEvents(xml: string): Promise<ParsedEvent[]> {
  const {items, base} = await entries(xml);
  return items.map(item => {
    const url = safeUrl(item.link, base), title = plain(item.title, 120);
    const start = parseWhen(text(item.evStart) || text(item.xStart)), end = parseWhen(text(item.evEnd) || text(item.xEnd));
    const place = plain(text(item.evLocation) || text(item.xLocation), 300), point = text(item.geoPoint).trim().split(/[\s,]+/);
    const lat = coordinate(text(item.geoLat) || point[0], 90), lng = coordinate(text(item.geoLong) || point[1], 180);
    const externalId = plain(item.guid || text(item.id) || url, 300) || 'h:' + createHash('sha256').update(title + '|' + (start.local || start.instant?.toISOString() || '')).digest('hex').slice(0, 32);
    return {externalId, title, description: plain(item.content || text(item.summary) || item.contentSnippet, 5000, true) || undefined, url,
      startsAt: start.instant, startsLocal: start.local, allDay: start.allDay, endsAt: end.instant, endsLocal: end.local,
      ...(place ? {venueName: place.split(',')[0].trim().slice(0, 160), ...(place.includes(',') ? {address: place} : {})} : {}),
      ...(lat !== undefined && lng !== undefined ? {lat, lng} : {})};
  });
}
