'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import {chatCall, ChatError, errorCode} from './shared';
import '../../app/styles/chat.css';
// Entry point to the chat room of an event or of a city. Exactly one of eventId and cityId must be set.
export function RoomLink({eventId, cityId, signedIn}: {eventId?: string; cityId?: string; signedIn: boolean}) {
  const t = useTranslations('Chat'), locale = useLocale(), router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const label = t(eventId ? 'openEventChat' : 'openCityChat');
  if (!signedIn) return <div className="chat-entry"><Link className="button secondary" href={'/' + locale + '/login'}>{t('signInToChat')}</Link></div>;
  async function open() {
    setBusy(true); setError('');
    try {
      const {id} = await chatCall<{id: string}>('/api/chat/rooms', 'POST', eventId ? {eventId} : {cityId});
      router.push('/' + locale + '/messages/' + id);
    } catch (failure) {setError(errorCode(failure)); setBusy(false);}
  }
  return <div className="chat-entry">
    <button type="button" className="button secondary" disabled={busy} onClick={open}>{busy ? t('opening') : label}</button>
    {eventId && !error && <small>{t('eventChatHint')}</small>}
    <ChatError code={error} t={t}/>
  </div>;
}
