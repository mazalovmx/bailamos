import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {NewPost} from '../../../../components/blog/new-post';
import {currentUser} from '../../../../lib/session';
import '../../../styles/blog.css';
export const metadata = {robots: {index: false, follow: false}};
export default async function NewPostPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  const t = await getTranslations('Blog');
  return <main className="detail-page blog-page">
    <p className="eyebrow"><Link href={'/' + locale + '/posts'}>{t('myPostsTitle')}</Link></p>
    <h1>{t('newPostTitle')}</h1><p className="intro">{t('newPostText')}</p>
    {!user.profile ? <p className="notice">{t('error_PROFILE_REQUIRED')} <Link href={'/' + locale + '/profile'}>{t('toProfile')}</Link></p> :
      !user.emailVerified ? <p className="notice">{t('error_VERIFY_EMAIL')}</p> : <NewPost/>}
  </main>;
}
