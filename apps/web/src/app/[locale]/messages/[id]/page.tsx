import {getTranslations} from 'next-intl/server';
import {notFound, redirect} from 'next/navigation';
import {currentUser} from '../../../../lib/session';
import {ApiError} from '../../../../lib/api';
import {conversationDetail, listMessages} from '../../../../lib/chat/service';
import {Thread} from '../../../../components/chat/thread';
import '../../../styles/chat.css';
export async function generateMetadata() {
  const t = await getTranslations('Chat');
  // The title stays generic: conversation names must not leak into browser history sync or referrers.
  return {title: t('title'), robots: {index: false}};
}
export default async function Conversation({params}: {params: Promise<{locale: string; id: string}>}) {
  const {locale, id} = await params, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  if (!user.profile) redirect('/' + locale + '/messages');
  const me = {userId: user.id, profileId: user.profile.id, role: user.role, name: user.profile.name};
  // Both calls pass the membership gate; a conversation the viewer does not belong to is a plain 404.
  const loaded = await Promise.all([conversationDetail(me, id), listMessages(me, id)]).catch(error => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
  if (!loaded) notFound();
  return <main className="form-page chat-page"><Thread initial={loaded[0]} initialPage={loaded[1]} myProfileId={me.profileId}/></main>;
}
