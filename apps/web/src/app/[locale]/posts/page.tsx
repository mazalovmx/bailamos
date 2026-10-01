import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {postPath} from '../../../lib/blog/links';
import {ownPosts} from '../../../lib/blog/posts';
import {currentUser} from '../../../lib/session';
import '../../styles/blog.css';
export const metadata = {robots: {index: false, follow: false}};
export default async function MyPosts({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  const t = await getTranslations('Blog');
  const posts = user.profile ? await ownPosts(user.profile.id) : [];
  const drafts = posts.filter(post => !post.publishedAt), published = posts.filter(post => post.publishedAt);
  const date = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeZone: 'UTC'});
  const row = (post: typeof posts[number]) => <li key={post.id} className="post-row">
    <div>
      <strong>{post.title || t('untitled')}</strong>
      <span className="post-meta">
        {post.publishedAt ? t('publishedOn', {date: date.format(post.publishedAt)}) : t('editedOn', {date: date.format(post.updatedAt)})}
        {post.hiddenAt ? ' · ' + t('hiddenByModeration') : ''}
      </span>
    </div>
    <div className="post-row-actions">
      <Link href={'/' + locale + '/posts/' + post.id + '/edit'}>{t('edit')}<span className="sr-only"> {post.title || t('untitled')}</span></Link>
      {post.publishedAt && post.slug && !post.hiddenAt && user.profile &&
        <Link href={postPath(locale, user.profile.handle, post.slug)}>{t('view')}<span className="sr-only"> {post.title}</span></Link>}
    </div>
  </li>;
  return <main className="detail-page blog-page">
    <h1>{t('myPostsTitle')}</h1><p className="intro">{t('myPostsText')}</p>
    {user.profile ? <Link className="button" href={'/' + locale + '/posts/new'}>{t('writePost')}</Link> :
      <p className="notice">{t('error_PROFILE_REQUIRED')} <Link href={'/' + locale + '/profile'}>{t('toProfile')}</Link></p>}
    <section aria-labelledby="my-drafts"><h2 id="my-drafts">{t('drafts')}</h2>
      {drafts.length ? <ul className="post-rows">{drafts.map(row)}</ul> : <p className="field-note">{t('noDrafts')}</p>}</section>
    <section aria-labelledby="my-published"><h2 id="my-published">{t('published')}</h2>
      {published.length ? <ul className="post-rows">{published.map(row)}</ul> : <p className="field-note">{t('noPublished')}</p>}</section>
  </main>;
}
