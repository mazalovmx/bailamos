import '../../app/styles/blog.css';
import Link from 'next/link';
import {postPath} from '../../lib/blog/links';
import type {PostCardData} from '../../lib/blog/posts';
import {Picture} from '../media/picture';
type Props = {post: PostCardData; locale: string; heading?: 'h2' | 'h3'; showAuthor?: boolean};
/** One published post in a list: optional first photo, title, date and summary. */
export function PostCard({post, locale, heading: Heading = 'h3', showAuthor = true}: Props) {
  if (!post.slug || !post.publishedAt) return null;
  const image = post.media[0];
  return <article className="post-card">
    {image?.storageKey && <Picture className="post-card-image" storageKey={image.storageKey} alt={image.alt || ''} width={image.width} height={image.height}
      sizes="(max-width: 600px) 100vw, 320px"/>}
    <div className="post-card-body">
      <Heading className="post-card-title"><Link href={postPath(locale, post.profile.handle, post.slug)}>{post.title}</Link></Heading>
      <p className="post-meta">
        {showAuthor && <><Link href={'/' + locale + '/people/' + post.profile.handle}>{post.profile.name}</Link> · </>}
        <time dateTime={post.publishedAt.toISOString()}>{new Intl.DateTimeFormat(locale, {dateStyle: 'long', timeZone: 'UTC'}).format(post.publishedAt)}</time>
      </p>
      {post.excerpt && <p className="post-card-excerpt">{post.excerpt}</p>}
    </div>
  </article>;
}
export function PostList({posts, locale, heading, showAuthor}: {posts: PostCardData[]; locale: string; heading?: 'h2' | 'h3'; showAuthor?: boolean}) {
  return <ul className="post-list">{posts.map(post => <li key={post.id}><PostCard post={post} locale={locale} heading={heading} showAuthor={showAuthor}/></li>)}</ul>;
}
