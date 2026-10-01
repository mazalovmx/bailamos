import {db} from '@dance/db';
import {cache} from 'react';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import {PostList} from '../../../../../components/blog/post-card';
import {alternates, postsPath, rssPath} from '../../../../../lib/blog/links';
import {publicPosts} from '../../../../../lib/blog/posts';
import {siteUrl} from '../../../../../lib/mail';
import '../../../../styles/blog.css';
type Props = {params: Promise<{locale: string; handle: string}>; searchParams: Promise<{before?: string | string[]}>};
const PAGE = 20;
const author = cache((handle: string) => db.profile.findFirst({where: {handle: handle.toLowerCase(), hiddenAt: null}, select: {id: true, handle: true, name: true}}));
export async function generateMetadata({params, searchParams}: Props): Promise<Metadata> {
  const {locale, handle} = await params, profile = await author(handle);
  if (!profile) return {robots: {index: false}};
  const t = await getTranslations({locale, namespace: 'Blog'}), origin = siteUrl();
  return {title: t('postsOf', {name: profile.name}), description: t('postsOfDescription', {name: profile.name}),
    // Older pages of the list are reachable but only the first one is indexed.
    ...((await searchParams).before ? {robots: {index: false, follow: true}} : {}),
    alternates: {canonical: origin + postsPath(locale, profile.handle), languages: alternates(origin, language => postsPath(language, profile.handle)),
      types: {'application/rss+xml': [{url: origin + rssPath(profile.handle, locale), title: t('rssTitle', {name: profile.name})}]}}};
}
export default async function AuthorPosts({params, searchParams}: Props) {
  const {locale, handle} = await params, profile = await author(handle);
  if (!profile) notFound();
  const raw = (await searchParams).before, parsed = typeof raw === 'string' ? new Date(raw) : null;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const [t, posts] = await Promise.all([getTranslations('Blog'), publicPosts({profileId: profile.id}, PAGE + 1, before)]);
  const shown = posts.slice(0, PAGE), last = shown[shown.length - 1];
  return <main className="detail-page blog-page">
    <p className="eyebrow"><Link href={'/' + locale + '/people/' + profile.handle}>@{profile.handle}</Link></p>
    <h1>{t('postsOf', {name: profile.name})}</h1>
    {shown.length ? <PostList posts={shown} locale={locale} heading="h2" showAuthor={false}/> : <p className="notice" role="status">{t('noPosts')}</p>}
    <p className="post-links">
      {posts.length > PAGE && last?.publishedAt &&
        <Link href={postsPath(locale, profile.handle) + '?before=' + encodeURIComponent(last.publishedAt.toISOString())}>{t('olderPosts')}</Link>}
      {before && <Link href={postsPath(locale, profile.handle)}>{t('newestPosts')}</Link>}
      <a href={rssPath(profile.handle, locale)} type="application/rss+xml">{t('rssLink')}</a>
    </p>
  </main>;
}
