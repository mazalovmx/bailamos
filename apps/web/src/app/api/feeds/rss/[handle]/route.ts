import {db} from '@dance/db';
import {apiError, ApiError} from '../../../../../lib/api';
import {blogLocale} from '../../../../../lib/blog/links';
import {rssResponse} from '../../../../../lib/blog/rss';
import {profileRss} from '../../../../../lib/blog/rss-feed';
import {siteUrl} from '../../../../../lib/mail';
export const dynamic = 'force-dynamic';
// RSS 2.0 of one author: /api/feeds/rss/<handle>[?locale=es|ru]. The locale only chooses which language version the
// links open; the posts are the same. Readers poll this URL, hence the ETag and the short public cache.
export async function GET(request: Request, {params}: {params: Promise<{handle: string}>}) {
  try {
    const handle = (await params).handle.toLowerCase(), locale = blogLocale(new URL(request.url).searchParams.get('locale'));
    const profile = /^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle) ? await db.profile.findFirst({where: {handle, hiddenAt: null},
      select: {id: true, handle: true, name: true, bio: true}}) : null;
    if (!profile) throw new ApiError('NOT_FOUND', 404);
    const {body, lastModified} = await profileRss(profile, locale, siteUrl());
    return rssResponse(request, body, lastModified);
  } catch (error) {return apiError(error);}
}
