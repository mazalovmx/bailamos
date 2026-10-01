'use client';
import {useCallback, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import type {ChatInbox, ChatProfile, ChatSummary} from '../../lib/chat/types';
import {Avatar, chatCall, ChatError, conversationTitle, errorCode} from './shared';
import {useConversationStream} from './use-conversation-stream';
export function Inbox({initial, initialBlocks}: {initial: ChatInbox; initialBlocks: ChatProfile[]}) {
  const t = useTranslations('Chat'), locale = useLocale(), router = useRouter();
  const [data, setData] = useState(initial), [blocks, setBlocks] = useState(initialBlocks);
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(async () => {setData(await chatCall<ChatInbox>('/api/chat/conversations'));}, []);
  // A burst of events causes one refresh.
  const onEvent = useCallback(() => {
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {void refresh().catch(() => undefined);}, 300);
  }, [refresh]);
  const mode = useConversationStream({onEvent, poll: refresh, pollMs: 15_000});
  const time = new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'short'});
  async function act(key: string, work: () => Promise<unknown>) {
    setBusy(key); setError(''); setNotice('');
    try {await work(); await refresh();} catch (failure) {setError(errorCode(failure));} finally {setBusy('');}
  }
  const reloadBlocks = async () => setBlocks((await chatCall<{blocks: ChatProfile[]}>('/api/chat/blocks')).blocks);
  async function createGroup(form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const handles = values.handles.split(/[\s,;]+/).filter(Boolean);
    setBusy('group'); setError(''); setNotice('');
    try {
      const result = await chatCall<{id: string; skipped: number}>('/api/chat/conversations', 'POST', {title: values.title, handles});
      if (result.skipped) {setNotice(t('skippedInvites', {count: result.skipped})); form.reset(); await refresh();}
      else router.push('/' + locale + '/messages/' + result.id);
    } catch (failure) {setError(errorCode(failure));} finally {setBusy('');}
  }
  const row = (conversation: ChatSummary, request: boolean) => {
    const title = conversationTitle(t, conversation), last = conversation.lastMessage;
    return <li key={conversation.id} className={'chat-row' + (conversation.unread ? ' unread' : '')}>
      <Avatar name={title} url={conversation.other?.avatarUrl ?? null}/>
      <div className="chat-row-main">
        <Link className="chat-row-title" href={'/' + locale + '/messages/' + conversation.id}>{title}</Link>
        {conversation.kind !== 'DIRECT' && <span className="chat-kind">{t('kind_' + conversation.kind)}</span>}
        <p className="chat-row-preview">{last ? <>{last.mine ? t('you') : last.senderName}: {last.hidden ? <em>{t('hiddenMessage')}</em> : last.body}</>
          : t('noMessagesYet')}</p>
        {request && <div className="chat-actions">
          <button type="button" className="button" disabled={!!busy} onClick={() => act(conversation.id, () => chatCall('/api/chat/conversations/' + conversation.id, 'PATCH', {action: 'accept'}))}>{t('accept')}</button>
          <button type="button" className="button secondary" disabled={!!busy} onClick={() => act(conversation.id, () => chatCall('/api/chat/conversations/' + conversation.id, 'DELETE', {}))}>{t('decline')}</button>
          {conversation.other && <button type="button" className="button secondary danger" disabled={!!busy} onClick={() => act(conversation.id, async () => {
            await chatCall('/api/chat/blocks', 'PUT', {profileId: conversation.other?.id}); await reloadBlocks();})}>{t('block')}</button>}
        </div>}
      </div>
      <div className="chat-row-meta">
        {last && <time dateTime={last.createdAt} suppressHydrationWarning>{time.format(new Date(last.createdAt))}</time>}
        {conversation.unread > 0 && <span className="chat-badge"><span aria-hidden="true">{conversation.unread > 99 ? '99+' : conversation.unread}</span>
          <span className="sr-only">{t('unreadCount', {count: conversation.unread})}</span></span>}
      </div>
    </li>;
  };
  return <div className="chat">
    <p className="chat-status" role="status">{t('status_' + mode)}</p>
    <ChatError code={error} t={t}/>
    {notice && <p role="status" className="chat-notice">{notice}</p>}
    {data.requests.length > 0 && <section aria-labelledby="chat-requests-title" className="chat-section">
      <h2 id="chat-requests-title">{t('requests')} <span className="chat-count">({data.requests.length})</span></h2>
      <p className="chat-hint">{t('requestsHint')}</p>
      <ul className="chat-list">{data.requests.map(conversation => row(conversation, true))}</ul>
    </section>}
    <section aria-labelledby="chat-conversations-title" className="chat-section">
      <h2 id="chat-conversations-title">{t('conversations')}</h2>
      {data.conversations.length ? <ul className="chat-list">{data.conversations.map(conversation => row(conversation, false))}</ul> : <p>{t('noConversations')}</p>}
    </section>
    <details className="chat-panel">
      <summary>{t('newGroup')}</summary>
      <form className="chat-form" onSubmit={event => {event.preventDefault(); void createGroup(event.currentTarget);}}>
        <label>{t('groupTitle')}<input name="title" required maxLength={80} autoComplete="off"/></label>
        <label>{t('groupHandles')}<input name="handles" maxLength={600} autoComplete="off" autoCapitalize="none" spellCheck={false}/><small>{t('groupHandlesHint')}</small></label>
        <button className="button" disabled={!!busy}>{t(busy === 'group' ? 'creating' : 'createGroup')}</button>
      </form>
    </details>
    <details className="chat-panel">
      <summary>{t('blockedPeople')} ({blocks.length})</summary>
      {blocks.length ? <ul className="chat-members">{blocks.map(profile => <li key={profile.id}>
        <Avatar name={profile.name} url={profile.avatarUrl}/><span>{profile.name} <small>@{profile.handle}</small></span>
        <button type="button" className="button secondary" disabled={!!busy} onClick={() => act('unblock', async () => {
          await chatCall('/api/chat/blocks', 'DELETE', {profileId: profile.id}); await reloadBlocks();})}>{t('unblock')}</button>
      </li>)}</ul> : <p>{t('noBlocked')}</p>}
    </details>
  </div>;
}
