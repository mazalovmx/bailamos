import {db} from '@dance/db';
import {mediaUrl} from '../media/url';
import {readEmbeds} from './embeds';
import {contentHtml} from './html';
import {absoluteUrl, postPath, postsPath, rssPath} from './links';
import {withoutEmbeds, withoutImages} from './nodes';
import {publicPostWhere} from './posts';
import {buildRss} from './rss';
export const RSS_POSTS = 30;
// Full bodies are sent until the feed reaches this size; older items then carry the summary only.
export const RSS_CONTENT_BUDGET = 1_000_000;
type Author = {id: string; handle: string; name: string; bio?: string | null};
/**
 * The RSS document of one author: the summary as description and the whole post as content:encoded.
 * Photos and Instagram blocks hidden by moderation are left out, exactly as on the page.
 */
export async function profileRss(profile: Author, locale: string, origin: string) {
  const posts = await db.post.findMany({where: {...publicPostWhere, profileId: profile.id, slug: {not: null}}, orderBy: [{publishedAt: 'desc'}, {id: 'desc'}],
    take: RSS_POSTS, select: {slug: true, title: true, excerpt: true, content: true, publishedAt: true,
      media: {orderBy: [{position: 'asc'}, {createdAt: 'asc'}],
        select: {id: true, kind: true, storageKey: true, sourceUrl: true, embedMeta: true, embedFetched: true, hiddenAt: true}}}});
  let budget = RSS_CONTENT_BUDGET;
  const items = posts.flatMap(post => {
    if (!post.slug || !post.publishedAt) return [];
    const {embeds, hidden} = readEmbeds(post.media);
    const body = withoutEmbeds(withoutImages(post.content, new Set(post.media.filter(item => item.kind === 'upload' && item.hiddenAt).map(item => item.id))), hidden);
    const html = budget > 0 ? contentHtml(body, {imageUrl: key => absoluteUrl(origin, mediaUrl(key)), embeds}) : '';
    budget -= html.length;
    const cover = post.media.find(item => item.kind === 'upload' && !item.hiddenAt && item.storageKey);
    return [{title: post.title, link: origin + postPath(locale, profile.handle, post.slug), description: post.excerpt, content: budget >= 0 ? html : null,
      publishedAt: post.publishedAt, author: profile.name, image: cover?.storageKey ? absoluteUrl(origin, mediaUrl(cover.storageKey)) : undefined}];
  });
  const body = buildRss({title: profile.name + ' (@' + profile.handle + ')', link: origin + postsPath(locale, profile.handle),
    self: origin + rssPath(profile.handle, locale), description: profile.bio?.slice(0, 300) || profile.name, language: locale, items});
  return {body, lastModified: items[0]?.publishedAt ?? null};
}
