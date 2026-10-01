import {db, type Prisma} from '@dance/db';
import {allCities, allStyles} from '../catalogue/data';
import {descendantIds} from '../catalogue/tree';
import {variants} from '../media/url';
import {afterCursor, decodeCursor, mergeFeed, type FeedEvent, type FeedItem, type FeedNews, type FeedPost} from './cursor';
export const FEED_PAGE = 20;
export type FeedMode = 'personal' | 'fallback';
export type FeedResult = {items: FeedItem[]; nextCursor: string | null; mode: FeedMode; city: {slug: string; name: string} | null};
type Options = {userId?: string | null; profileId?: string | null; citySlug?: string | null; cursor?: string | null; limit?: number; now?: Date};
/**
 * One page of the feed: upcoming events of followed cities and styles (a style brings its sub-styles), posts of
 * followed profiles and imported news of followed cities and the current city, merged newest first.
 * Without a session or without subscriptions it falls back to the current city and the latest posts.
 *
 * Bounded work: one read of the subscriptions, then at most three list queries of `limit + 1` rows each
 * (plus the related rows Prisma batches for them) — never a query per item. An event enters the stream when
 * it was created, a post and a news item when they were published.
 */
export async function feedPage(options: Options): Promise<FeedResult> {
  const limit = Math.min(Math.max(options.limit ?? FEED_PAGE, 1), 50), take = limit + 1;
  const now = options.now ?? new Date(), cursor = decodeCursor(options.cursor);
  const [follows, cities] = await Promise.all([
    options.userId ? db.follow.findMany({where: {userId: options.userId}, orderBy: {createdAt: 'desc'}, take: 1000,
      select: {cityId: true, styleId: true, profileId: true}}) : [],
    allCities()]);
  const current = options.citySlug ? cities.find(city => city.slug === options.citySlug) || null : null;
  const cityIds = follows.flatMap(follow => follow.cityId ? [follow.cityId] : []);
  const profileIds = follows.flatMap(follow => follow.profileId ? [follow.profileId] : []);
  const followedStyles = follows.flatMap(follow => follow.styleId ? [follow.styleId] : []);
  const styles = followedStyles.length ? await allStyles() : [];
  const styleIds = [...new Set(followedStyles.flatMap(id => descendantIds(styles, id)))];
  const personal = follows.length > 0;
  const upcoming = {startsAt: {gte: now}, cancelled: false};
  const eventScope: Prisma.EventWhereInput | null = personal
    ? (cityIds.length || styleIds.length ? {OR: [...(cityIds.length ? [{cityId: {in: cityIds}}] : []),
      ...(styleIds.length ? [{styles: {some: {styleId: {in: styleIds}}}}] : [])]} : null)
    : current ? {cityId: current.id} : {};
  // People who blocked the viewer, or whom the viewer blocked, stay out of the stream.
  const me = options.profileId;
  const author: Prisma.ProfileWhereInput = {hiddenAt: null,
    ...(me ? {blocksMade: {none: {blockedProfileId: me}}, blocksReceived: {none: {blockerProfileId: me}}} : {})};
  const postScope: Prisma.PostWhereInput | null = personal ? (profileIds.length ? {profileId: {in: profileIds}} : null) : {};
  const newsCities = [...new Set([...cityIds, ...(current ? [current.id] : [])])];
  const newsScope: Prisma.NewsItemWhereInput | null = newsCities.length ? {cityId: {in: newsCities}} : personal ? null : {};
  const [events, posts, news] = await Promise.all([
    eventScope ? db.event.findMany({
      where: {AND: [{status: 'PUBLISHED', hiddenAt: null, occurrences: {some: upcoming}}, eventScope, afterCursor(cursor, 'event', 'createdAt')]},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take,
      select: {id: true, slug: true, title: true, kind: true, createdAt: true, startsAt: true, timezone: true, city: {select: {name: true}},
        styles: {select: {style: {select: {name: true}}}},
        occurrences: {where: upcoming, orderBy: {startsAt: 'asc'}, take: 1, select: {startsAt: true}}}}) : [],
    postScope ? db.post.findMany({
      where: {AND: [{publishedAt: {not: null}, slug: {not: null}, hiddenAt: null, profile: author}, postScope, afterCursor(cursor, 'post', 'publishedAt')]},
      orderBy: [{publishedAt: 'desc'}, {id: 'desc'}], take,
      select: {id: true, slug: true, title: true, excerpt: true, publishedAt: true, profile: {select: {handle: true, name: true}},
        media: {where: {kind: 'upload', hiddenAt: null}, orderBy: [{position: 'asc'}, {createdAt: 'asc'}], take: 1,
          select: {storageKey: true, width: true, height: true, alt: true}}}}) : [],
    // The importer that fills NewsItem arrives later; until then this is simply an empty list.
    newsScope ? db.newsItem.findMany({
      where: {AND: [{hiddenAt: null, publishedAt: {lte: now}}, newsScope, afterCursor(cursor, 'news', 'publishedAt')]},
      orderBy: [{publishedAt: 'desc'}, {id: 'desc'}], take,
      select: {id: true, url: true, title: true, summary: true, publishedAt: true, city: {select: {name: true}}, source: {select: {name: true}}}}) : []
  ]);
  const eventItems: FeedEvent[] = events.map(event => ({kind: 'event', id: event.id, at: event.createdAt.toISOString(), slug: event.slug, title: event.title,
    eventKind: event.kind, startsAt: (event.occurrences[0]?.startsAt ?? event.startsAt).toISOString(), timezone: event.timezone, city: event.city.name,
    styles: event.styles.map(link => link.style.name)}));
  const postItems: FeedPost[] = posts.map(post => {
    const image = post.media[0];
    return {kind: 'post', id: post.id, at: post.publishedAt!.toISOString(), slug: post.slug!, title: post.title, excerpt: post.excerpt, author: post.profile,
      image: image?.storageKey ? {sources: variants(image.storageKey, image.width), alt: image.alt || '', width: image.width, height: image.height} : null};
  });
  const newsItems: FeedNews[] = news.map(item => ({kind: 'news', id: item.id, at: item.publishedAt.toISOString(), url: item.url, title: item.title,
    summary: item.summary, source: item.source.name, city: item.city?.name ?? null}));
  return {...mergeFeed([eventItems, postItems, newsItems], limit), mode: personal ? 'personal' : 'fallback',
    city: current ? {slug: current.slug, name: current.name} : null};
}
