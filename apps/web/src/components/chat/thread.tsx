'use client';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import type {ChatDetail, ChatEvent, ChatMessage, ChatPage} from '../../lib/chat/types';
import {ReportButton} from '../moderation/report-button';
import {Avatar, chatCall, ChatError, conversationTitle, errorCode, MessageBody} from './shared';
import {useConversationStream} from './use-conversation-stream';
const MAX = 2000;
const merge = (current: ChatMessage[], incoming: ChatMessage[]) => {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);
};
export function Thread({initial, initialPage, myProfileId}: {initial: ChatDetail; initialPage: ChatPage; myProfileId: string}) {
  const t = useTranslations('Chat'), locale = useLocale(), router = useRouter();
  const id = initial.id, base = '/api/chat/conversations/' + id;
  const [detail, setDetail] = useState(initial), [messages, setMessages] = useState(initialPage.messages), [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [text, setText] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [announcement, setAnnouncement] = useState('');
  const scroller = useRef<HTMLDivElement>(null), stick = useRef(true), keep = useRef<number | null>(null), latest = useRef(messages);
  useEffect(() => {latest.current = messages;}, [messages]);
  const time = new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'short'});
  const title = conversationTitle(t, detail);
  const markRead = useCallback(() => {
    if (!document.hidden) void chatCall(base, 'PATCH', {action: 'read'}).catch(() => undefined);
  }, [base]);
  const refreshDetail = useCallback(async () => {
    try {setDetail(await chatCall<ChatDetail>(base));} catch (failure) {
      // Removed from the conversation, or it no longer exists.
      if (errorCode(failure) === 'NOT_FOUND') router.replace('/' + locale + '/messages');
    }
  }, [base, locale, router]);
  const incoming = useCallback((fresh: ChatMessage[]) => {
    const known = new Set(latest.current.map(message => message.id));
    const added = fresh.filter(message => !known.has(message.id) && message.sender.id !== myProfileId);
    setMessages(current => merge(current, fresh));
    const last = added[added.length - 1];
    if (!last) return;
    setAnnouncement(t('newMessageFrom', {name: last.sender.name, text: last.hidden ? t('hiddenMessage') : (last.body ?? '').slice(0, 200)}));
    markRead();
  }, [markRead, myProfileId, t]);
  const poll = useCallback(async () => {
    const last = latest.current[latest.current.length - 1];
    const page = await chatCall<ChatPage>(base + '/messages' + (last ? '?after=' + encodeURIComponent(last.id) + '&limit=100' : ''));
    if (page.messages.length) incoming(page.messages);
  }, [base, incoming]);
  const onEvent = useCallback((event: ChatEvent) => {
    if (event.type === 'message') incoming([event.message]);
    else if (event.type === 'hidden') {
      // The text of a hidden message is dropped locally; a restored one is fetched again because the stream never carries it.
      if (event.hidden) setMessages(current => current.map(message => message.id === event.messageId ? {...message, hidden: true, body: null} : message));
      else void chatCall<ChatPage>(base + '/messages?limit=100').then(page => setMessages(current => merge(current, page.messages))).catch(() => undefined);
    } else void refreshDetail();
  }, [base, incoming, refreshDetail]);
  const mode = useConversationStream({conversationId: id, onEvent, poll});
  useEffect(() => {markRead();}, [markRead]);
  // Keeps the view at the newest message unless the reader scrolled up; loading older messages keeps the reading position.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (keep.current !== null) {box.scrollTop = box.scrollHeight - keep.current; keep.current = null;}
    else if (stick.current) box.scrollTop = box.scrollHeight;
  }, [messages]);
  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key); setError('');
    try {await work();} catch (failure) {setError(errorCode(failure));} finally {setBusy('');}
  }
  const loadOlder = () => run('older', async () => {
    const first = messages[0];
    if (!first) return;
    const page = await chatCall<ChatPage>(base + '/messages?before=' + encodeURIComponent(first.id));
    const box = scroller.current;
    keep.current = box ? box.scrollHeight - box.scrollTop : null;
    setMessages(current => merge(current, page.messages));
    setHasMore(page.hasMore);
  });
  const send = () => run('send', async () => {
    const body = text.trim();
    if (!body) return;
    const {message} = await chatCall<{message: ChatMessage}>(base + '/messages', 'POST', {body});
    stick.current = true;
    setText('');
    setMessages(current => merge(current, [message]));
    if (detail.requestRemaining !== null) await refreshDetail();
  });
  const toInbox = () => {router.push('/' + locale + '/messages'); router.refresh();};
  const accept = () => run('accept', async () => {await chatCall(base, 'PATCH', {action: 'accept'}); await refreshDetail();});
  const leave = () => run('leave', async () => {await chatCall(base, 'DELETE', {}); toInbox();});
  const block = () => run('block', async () => {await chatCall('/api/chat/blocks', 'PUT', {profileId: detail.other?.id}); if (detail.accepted) await refreshDetail(); else toInbox();});
  const unblock = () => run('block', async () => {await chatCall('/api/chat/blocks', 'DELETE', {profileId: detail.other?.id}); await refreshDetail();});
  const setHidden = (message: ChatMessage, hidden: boolean) => run('hide', async () => {
    await chatCall('/api/chat/messages/' + message.id, 'PATCH', {hidden});
    if (hidden) setMessages(current => current.map(item => item.id === message.id ? {...item, hidden: true, body: null} : item));
    else {const page = await chatCall<ChatPage>(base + '/messages?limit=100'); setMessages(current => merge(current, page.messages));}
  });
  const invite = (form: HTMLFormElement) => run('invite', async () => {
    await chatCall(base + '/members', 'POST', {handle: String(new FormData(form).get('handle') ?? '')});
    form.reset();
    await refreshDetail();
  });
  const remove = (profileId: string) => run('remove', async () => {await chatCall(base + '/members', 'DELETE', {profileId}); await refreshDetail();});
  const canWrite = detail.accepted && !detail.readOnly && !detail.blockedByMe && detail.requestRemaining !== 0;
  return <div className="chat chat-thread">
    <header className="chat-head">
      <Link className="chat-back" href={'/' + locale + '/messages'}><span aria-hidden="true">←</span> {t('back')}</Link>
      <h1>{title}</h1>
      <p className="chat-sub">
        {detail.kind !== 'DIRECT' && <span className="chat-kind">{t('kind_' + detail.kind)}</span>}
        {detail.kind !== 'DIRECT' && <span>{t('memberCount', {count: detail.memberCount})}</span>}
        {detail.kind === 'DIRECT' && detail.other && <Link href={'/' + locale + '/people/' + detail.other.handle}>@{detail.other.handle}</Link>}
        {detail.event && <Link href={'/' + locale + '/events/' + detail.event.slug}>{t('viewEvent')}</Link>}
        {detail.city && <Link href={'/' + locale + '/cities/' + detail.city.slug}>{t('viewCity')}</Link>}
        <span className="chat-status" role="status">{t('status_' + mode)}</span>
      </p>
    </header>
    {detail.kind !== 'DIRECT' && <details className="chat-panel">
      <summary>{detail.kind === 'GROUP' ? t('members', {count: detail.members.length}) : t('roomAdmins', {count: detail.members.length})}</summary>
      <ul className="chat-members">{detail.members.map(member => <li key={member.id}>
        <Avatar name={member.name} url={member.avatarUrl}/>
        <span><Link href={'/' + locale + '/people/' + member.handle}>{member.name}</Link> <small>@{member.handle}{member.admin ? ' · ' + t('admin') : ''}{member.accepted ? '' : ' · ' + t('invited')}</small></span>
        {detail.kind === 'GROUP' && detail.admin && member.id !== myProfileId &&
          <button type="button" className="button secondary" disabled={!!busy} aria-label={t('removeMember', {name: member.name})} onClick={() => remove(member.id)}>{t('remove')}</button>}
      </li>)}</ul>
      {detail.kind === 'GROUP' && detail.admin && detail.accepted && <form className="chat-form chat-invite" onSubmit={event => {event.preventDefault(); void invite(event.currentTarget);}}>
        <label>{t('inviteLabel')}<input name="handle" required maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false}/></label>
        <button className="button secondary" disabled={!!busy}>{t('inviteButton')}</button>
      </form>}
      {detail.accepted && <button type="button" className="button secondary danger" disabled={!!busy} onClick={leave}>{t('leave')}</button>}
    </details>}
    {!detail.accepted && <section className="chat-banner" aria-labelledby="chat-request-title">
      <h2 id="chat-request-title">{t('requestTitle')}</h2>
      <p>{detail.kind === 'DIRECT' ? t('requestBanner', {name: title}) : t('groupRequestBanner', {title})}</p>
      <div className="chat-actions">
        <button type="button" className="button" disabled={!!busy} onClick={accept}>{t('accept')}</button>
        <button type="button" className="button secondary" disabled={!!busy} onClick={leave}>{t('decline')}</button>
        {detail.other && <button type="button" className="button secondary danger" disabled={!!busy} onClick={block}>{t('block')}</button>}
      </div>
    </section>}
    <div className="chat-scroll" ref={scroller} tabIndex={0} role="region" aria-label={t('messagesIn', {title})}
      onScroll={event => {const box = event.currentTarget; stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;}}>
      {hasMore && <button type="button" className="button secondary chat-older" disabled={!!busy} onClick={loadOlder}>{t(busy === 'older' ? 'loading' : 'loadOlder')}</button>}
      {messages.length ? <ol className="chat-messages">{messages.map(message => {
        const mine = message.sender.id === myProfileId;
        return <li key={message.id} className={'chat-message' + (mine ? ' mine' : '')}>
          <p className="chat-message-meta">
            {mine ? <strong>{t('you')}</strong> : <Link href={'/' + locale + '/people/' + message.sender.handle}>{message.sender.name}</Link>}
            <time dateTime={message.createdAt} suppressHydrationWarning>{time.format(new Date(message.createdAt))}</time>
          </p>
          {message.hidden || message.body === null ? <p className="chat-message-body hidden"><em>{t('hiddenMessage')}</em></p> :
            <p className="chat-message-body"><MessageBody text={message.body}/></p>}
          <div className="chat-message-actions">
            {/* Reporting goes to the platform moderators; hiding is the room admin's own tool. */}
            {!mine && !message.hidden && <ReportButton targetType="MESSAGE" targetId={message.id} signedIn/>}
            {detail.canModerate && <button type="button" className="report-link" disabled={!!busy} onClick={() => setHidden(message, !message.hidden)}>{t(message.hidden ? 'unhide' : 'hide')}</button>}
          </div>
        </li>;
      })}</ol> : <p className="chat-empty">{t('noMessagesYet')}</p>}
    </div>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    <ChatError code={error} t={t}/>
    {detail.blockedByMe && <div className="chat-banner"><p>{t('blockedBanner')}</p>
      <button type="button" className="button secondary" disabled={!!busy} onClick={unblock}>{t('unblock')}</button></div>}
    {detail.readOnly && <p className="chat-banner">{t(detail.kind === 'DIRECT' ? 'error_CHAT_UNAVAILABLE' : 'readOnlyRoom')}</p>}
    {detail.accepted && !detail.readOnly && !detail.blockedByMe && detail.requestRemaining !== null && <p className="chat-banner" role="status">
      {detail.requestRemaining ? t('requestPending', {name: title, count: detail.requestRemaining}) : t('requestLimitReached', {name: title})}</p>}
    {canWrite && <form className="chat-composer" onSubmit={event => {event.preventDefault(); void send();}}>
      <label htmlFor="chat-text" className="sr-only">{t('messageLabel')}</label>
      <textarea id="chat-text" rows={2} maxLength={MAX} value={text} placeholder={t('messagePlaceholder')} aria-describedby="chat-text-hint"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); void send();}}}/>
      <button className="button" disabled={busy === 'send' || !text.trim()}>{t(busy === 'send' ? 'sending' : 'send')}</button>
      <small id="chat-text-hint">{t('composerHint')} · {t('charsLeft', {count: MAX - text.length})}</small>
    </form>}
    {detail.kind === 'DIRECT' && detail.accepted && !detail.blockedByMe && detail.other && <div className="chat-actions chat-foot">
      <button type="button" className="report-link" disabled={!!busy} onClick={block}>{t('block')}</button>
      <button type="button" className="report-link" disabled={!!busy} onClick={leave}>{t('leaveDirect')}</button>
    </div>}
  </div>;
}
