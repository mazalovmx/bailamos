import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {inbox, listBlocks} from '../../../lib/chat/service';
import {Inbox} from '../../../components/chat/inbox';
import '../../styles/chat.css';
export async function generateMetadata() {
  const t = await getTranslations('Chat');
  return {title: t('title'), robots: {index: false}};
}
export default async function Messages({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  const t = await getTranslations('Chat');
  if (!user.profile) return <main className="form-page chat-page"><h1>{t('title')}</h1><p className="intro">{t('error_PROFILE_REQUIRED')}</p>
    <Link className="button" href={'/' + locale + '/profile'}>{t('createProfile')}</Link></main>;
  const me = {userId: user.id, profileId: user.profile.id, role: user.role, name: user.profile.name, schoolIds: user.schoolIds};
  const [initial, blocks] = await Promise.all([inbox(me), listBlocks(me)]);
  return <main className="form-page chat-page"><h1>{t('title')}</h1><p className="intro">{t('inboxIntro')}</p>
    <Inbox initial={initial} initialBlocks={blocks}/>
  </main>;
}
