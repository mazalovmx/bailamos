import {db} from '@dance/db';
import {cache} from 'react';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import {PostBody} from '../../../../../../components/blog/post-body';
import {FollowButton} from '../../../../../../components/catalogue/follow-button';
import {EventCard} from '../../../../../../components/event-card';
import {ReportButton} from '../../../../../../components/moderation/report-button';
import {postJsonLd, safeJson} from '../../../../../../lib/blog/jsonld';
import {absoluteUrl, alternates, postPath, postsPath, rssPath} from '../../../../../../lib/blog/links';
import {firstImage, withoutImages} from '../../../../../../lib/blog/nodes';
import {canPost} from '../../../../../../lib/blog/permissions';
import {publicPostWhere} from '../../../../../../lib/blog/posts';
import {isFollowing} from '../../../../../../lib/catalogue/follows';
import {siteUrl} from '../../../../../../lib/mail';
import {mediaUrl} from '../../../../../../lib/media/url';
import {currentUser} from '../../../../../../lib/session';
import '../../../../../styles/blog.css';
import '../../../../../styles/events.css';
type Params = {params: Promise<{locale: string; handle: string; slug: string}>};
// Published, not hidden, by a visible profile — and addressed through its own author's handle.
const publicPost = cache(async (handle: string, slug: string) => {
  const post = await db.post.findFirst({where: {...publicPostWhere, slug, profile: {handle: handle.toLowerCase(), hiddenAt: null}}, select: {
    id: true, slug: true, title: true, excerpt: true, content: true, publishedAt: true, updatedAt: true, hiddenAt: true, profileId: true,
    profile: {select: {id: true, handle: true, name: true, type: true}},
    event: {include: {city: true, styles: {include: {style: true}}}},
    // Photos hidden by moderation leave the page even though the stored body still names them.
    media: {where: {hiddenAt: {not: null}}, select: {id: true}}}});
  if (!post?.publishedAt || !post.slug) return null;
  const content = withoutImages(post.content, new Set(post.media.map(item => item.id)));
  const event = post.event && post.event.status !== 'DRAFT' && !post.event.hiddenAt ? post.event : null;
  return {...post, publishedAt: post.publishedAt, slug: post.slug, content, event};
});
export async function generateMetadata({params}: Params): Promise<Metadata> {
  const {locale, handle, slug} = await params, post = await publicPost(handle, slug);
  if (!post) return {robots: {index: false}};
  const t = await getTranslations({locale, namespace: 'Blog'});
  const origin = siteUrl(), url = origin + postPath(locale, post.profile.handle, post.slug), image = firstImage(post.content);
  const description = (post.excerpt || t('metaDescription', {title: post.title, name: post.profile.name})).slice(0, 200);
  const images = image ? [{url: absoluteUrl(origin, mediaUrl(image.storageKey, 1600)), alt: image.alt}] : undefined;
  return {title: post.title + ' — ' + post.profile.name, description,
    alternates: {canonical: url, languages: alternates(origin, language => postPath(language, post.profile.handle, post.slug)),
      types: {'application/rss+xml': [{url: origin + rssPath(post.profile.handle, locale), title: t('rssTitle', {name: post.profile.name})}]}},
    openGraph: {type: 'article', title: post.title, description, url, publishedTime: post.publishedAt.toISOString(), modifiedTime: post.updatedAt.toISOString(),
      authors: [origin + '/@' + post.profile.handle], ...(images ? {images} : {})},
    twitter: {card: images ? 'summary_large_image' : 'summary', title: post.title, description}};
}
export default async function PostPage({params}: Params) {
  const {locale, handle, slug} = await params, post = await publicPost(handle, slug);
  if (!post) notFound();
  const [t, user] = await Promise.all([getTranslations('Blog'), currentUser()]);
  const own = !!user && canPost(user, 'update', post);
  const following = own ? false : await isFollowing(user?.id, {profileId: post.profile.id});
  const origin = siteUrl(), image = firstImage(post.content);
  const jsonLd = postJsonLd(post, {origin, locale, url: origin + postPath(locale, post.profile.handle, post.slug),
    image: image ? absoluteUrl(origin, mediaUrl(image.storageKey, 1600)) : undefined});
  return <main className="detail-page blog-page">
    {/* JSON-LD is a data block, not executable script, so it is CSP-safe; "<" is escaped so user text cannot close the element. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: safeJson(jsonLd)}}/>
    <article className="post-article" aria-labelledby="post-title">
      <header>
        <p className="eyebrow"><Link href={postsPath(locale, post.profile.handle)}>{t('postsOf', {name: post.profile.name})}</Link></p>
        <h1 id="post-title">{post.title}</h1>
        <p className="post-meta">
          <Link href={'/' + locale + '/people/' + post.profile.handle}>{post.profile.name}</Link> · <time dateTime={post.publishedAt.toISOString()}>
            {new Intl.DateTimeFormat(locale, {dateStyle: 'long', timeZone: 'UTC'}).format(post.publishedAt)}</time>
        </p>
      </header>
      <PostBody content={post.content}/>
    </article>
    {post.event && <section className="post-section" aria-labelledby="post-event-title">
      <h2 id="post-event-title">{t('wasHere')}</h2>
      <div className="event-grid"><EventCard event={post.event} locale={locale}/></div>
    </section>}
    <footer className="post-footer">
      {own ? <Link className="button secondary" href={'/' + locale + '/posts/' + post.id + '/edit'}>{t('edit')}</Link> : <>
        <FollowButton target={{profileId: post.profile.id}} initialFollowing={following} signedIn={!!user}/>
        <ReportButton targetType="POST" targetId={post.id} signedIn={!!user}/>
      </>}
      <a href={rssPath(post.profile.handle, locale)} type="application/rss+xml">{t('rssLink')}</a>
    </footer>
  </main>;
}
