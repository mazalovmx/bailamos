import {getLocale, getTranslations} from 'next-intl/server';
import {publicPosts} from '../../lib/blog/posts';
import {PostList} from './post-card';
/** "I was here": published posts linked to an event, for the event page. Renders nothing when there are none. */
export async function EventPosts({eventId}: {eventId: string}) {
  const posts = await publicPosts({eventId}, 12);
  if (!posts.length) return null;
  const [t, locale] = await Promise.all([getTranslations('Blog'), getLocale()]);
  return <section className="post-section" aria-labelledby="event-posts-title">
    <h2 id="event-posts-title">{t('eventPostsTitle')}</h2>
    <PostList posts={posts} locale={locale}/>
  </section>;
}
