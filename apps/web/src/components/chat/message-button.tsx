'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import {chatCall, ChatError, errorCode} from './shared';
import '../../app/styles/chat.css';
// "Message" on a profile page: opens (or creates) the direct conversation and goes to it. Do not mount it on the viewer's own profile.
export function MessageButton({profileId, signedIn}: {profileId: string; signedIn: boolean}) {
  const t = useTranslations('Chat'), locale = useLocale(), router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!signedIn) return <div className="chat-entry"><Link className="button secondary" href={'/' + locale + '/login'}>{t('signInToMessage')}</Link></div>;
  async function open() {
    setBusy(true); setError('');
    try {
      const {id} = await chatCall<{id: string}>('/api/chat/direct', 'POST', {profileId});
      router.push('/' + locale + '/messages/' + id);
    } catch (failure) {setError(errorCode(failure)); setBusy(false);}
  }
  return <div className="chat-entry">
    <button type="button" className="button secondary" disabled={busy} onClick={open}>{t(busy ? 'opening' : 'message')}</button>
    <ChatError code={error} t={t}/>
  </div>;
}
