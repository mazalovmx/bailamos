import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {postsPath, rssPath} from '../../lib/blog/links';
import {publicPosts} from '../../lib/blog/posts';
import {PostList} from './post-card';
const SHOWN = 5;
/** Latest posts of a profile, for its public page. Renders nothing for a visitor when there are no posts. */
export async function ProfilePosts({profileId, handle, locale, own = false}: {profileId: string; handle: string; locale: string; own?: boolean}) {
  const posts = await publicPosts({profileId}, SHOWN + 1);
  if (!posts.length && !own) return null;
  const t = await getTranslations({locale, namespace: 'Blog'});
  return <section className="profile-section post-section" aria-labelledby="profile-posts-title">
    <h2 id="profile-posts-title">{t('profilePostsTitle')}</h2>
    {posts.length ? <PostList posts={posts.slice(0, SHOWN)} locale={locale} showAuthor={false}/> : <p className="field-note">{t('noPostsOwn')}</p>}
    <p className="post-links">
      {posts.length > SHOWN && <Link href={postsPath(locale, handle)}>{t('allPosts')}</Link>}
      {posts.length > 0 && <a href={rssPath(handle, locale)} type="application/rss+xml">{t('rssLink')}</a>}
      {own && <Link href={'/' + locale + '/posts/new'}>{t('writePost')}</Link>}
    </p>
  </section>;
}
