import {loginPath} from '../../../../../lib/login-path';
import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {notFound, redirect} from 'next/navigation';
import Link from 'next/link';
import {PostEditor} from '../../../../../components/blog/post-editor';
import {canPost} from '../../../../../lib/blog/permissions';
import {publicEventWhere} from '../../../../../lib/blog/posts';
import {currentUser} from '../../../../../lib/session';
import '../../../../styles/blog.css';
export async function generateMetadata() {const t = await getTranslations('Blog'); return {title: t('editPostTitle'), robots: {index: false, follow: false}};}
export default async function EditPost({params}: {params: Promise<{locale: string; id: string}>}) {
  const {locale, id} = await params, user = await currentUser();
  if (!user) redirect(loginPath(locale, '/posts/' + id + '/edit'));
  const post = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await db.post.findUnique({where: {id}, include: {profile: {select: {handle: true, name: true}}}}) : null;
  // Somebody else's post does not exist here, published or not.
  if (!post || !canPost(user, 'update', post)) notFound();
  const t = await getTranslations('Blog');
  // "I was here" candidates: events the author answered or helps to run, plus the one already linked.
  const events = await db.event.findMany({where: {...publicEventWhere, OR: [{id: post.eventId ?? ''},
    {rsvps: {some: {profileId: post.profileId, status: {in: ['GOING', 'INTERESTED']}}}}, {members: {some: {profileId: post.profileId}}}]},
    orderBy: {startsAt: 'desc'}, take: 60, select: {id: true, title: true, startsAt: true, timezone: true, city: {select: {name: true}}}});
  const options = events.map(event => ({id: event.id, label: event.title + ' — ' +
    new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeZone: event.timezone}).format(event.startsAt) + ', ' + event.city.name}));
  return <main className="detail-page blog-page">
    <p className="eyebrow"><Link href={'/' + locale + '/posts'}>{t('myPostsTitle')}</Link></p>
    <h1>{t('editPostTitle')}</h1>
    {post.hiddenAt && <p className="notice" role="status">{t('hiddenNotice')}</p>}
    <PostEditor events={options} post={{id: post.id, title: post.title, content: post.content, published: !!post.publishedAt, slug: post.slug,
      updatedAt: post.updatedAt.toISOString(), handle: post.profile.handle, publisher: post.profileId === user.profile?.id ? null : post.profile.name, eventId: options.some(option => option.id === post.eventId) ? post.eventId : null}}/>
  </main>;
}
