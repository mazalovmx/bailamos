import {db} from '@dance/db';
import {apiError, ApiError} from '../../../../../lib/api';
import {absoluteUrl, blogLocale, postPath, postsPath, rssPath} from '../../../../../lib/blog/links';
import {publicPosts} from '../../../../../lib/blog/posts';
import {buildRss, rssResponse} from '../../../../../lib/blog/rss';
import {siteUrl} from '../../../../../lib/mail';
import {mediaUrl} from '../../../../../lib/media/url';
export const dynamic = 'force-dynamic';
// RSS 2.0 of one author: /api/feeds/rss/<handle>[?locale=es|ru]. The locale only chooses which language version the
// links open; the posts are the same. Readers poll this URL, hence the ETag and the short public cache.
export async function GET(request: Request, {params}: {params: Promise<{handle: string}>}) {
  try {
    const handle = (await params).handle.toLowerCase(), locale = blogLocale(new URL(request.url).searchParams.get('locale'));
    const profile = /^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle) ? await db.profile.findFirst({where: {handle, hiddenAt: null},
      select: {id: true, handle: true, name: true, bio: true}}) : null;
    if (!profile) throw new ApiError('NOT_FOUND', 404);
    const posts = await publicPosts({profileId: profile.id}, 30), origin = siteUrl();
    const body = buildRss({title: profile.name + ' (@' + profile.handle + ')', link: origin + postsPath(locale, profile.handle),
      self: origin + rssPath(profile.handle, locale), description: profile.bio?.slice(0, 300) || profile.name, language: locale,
      items: posts.flatMap(post => post.slug && post.publishedAt ? [{title: post.title, link: origin + postPath(locale, profile.handle, post.slug),
        description: post.excerpt, publishedAt: post.publishedAt, author: profile.name,
        image: post.media[0]?.storageKey ? absoluteUrl(origin, mediaUrl(post.media[0].storageKey)) : undefined}] : [])});
    return rssResponse(request, body, posts[0]?.publishedAt ?? null);
  } catch (error) {return apiError(error);}
}
