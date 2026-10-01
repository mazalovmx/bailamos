'use client';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import {applyEvent, mergeMessages} from '../../lib/chat/merge';
import type {ChatDetail, ChatEvent, ChatMessage, ChatPage} from '../../lib/chat/types';
import {IMAGE_TYPES, uploadImage} from '../media/image-upload';
import {ReportButton} from '../moderation/report-button';
import {Avatar, chatCall, conversationTitle, errorCode, MessageBody} from './shared';
import {useConversationStream} from './use-conversation-stream';
const MAX = 2000, MAX_FILE = 10 * 1024 * 1024, EDIT_MS = 15 * 60_000, REFRESH_PAGES = 5;
const SIZES = '(max-width: 600px) 80vw, 480px';
export function Thread({initial, initialPage}: {initial: ChatDetail; initialPage: ChatPage}) {
  const t = useTranslations('Chat'), tm = useTranslations('Media'), locale = useLocale(), router = useRouter();
  const id = initial.id, base = '/api/chat/conversations/' + id;
  const [detail, setDetail] = useState(initial), [messages, setMessages] = useState(initialPage.messages), [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [text, setText] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [announcement, setAnnouncement] = useState('');
  const [file, setFile] = useState<File | null>(null), [editing, setEditing] = useState<{id: string; text: string} | null>(null);
  const [confirming, setConfirming] = useState(''), [revealed, setRevealed] = useState<string[]>([]), [now, setNow] = useState(0);
  const scroller = useRef<HTMLDivElement>(null), stick = useRef(true), keep = useRef<number | null>(null), latest = useRef(messages);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {latest.current = messages;}, [messages]);
  // The edit window is measured against the reader's clock after hydration, and re-checked while the thread stays open.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const time = new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'short'});
  const title = conversationTitle(t, detail), me = detail.actingProfileId, school = detail.school, room = detail.kind !== 'DIRECT';
  const errorText = (code: string) => t.has('error_' + code) ? t('error_' + code) : tm.has('error_' + code) ? tm('error_' + code) : t('error_GENERIC');
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
    const added = fresh.filter(message => !known.has(message.id) && message.sender.id !== me);
    setMessages(current => mergeMessages(current, fresh));
    if (!added.length) return;
    markRead();
    // Messages collapsed because the reader blocked their sender are not read out either.
    const last = added.filter(message => !(room && message.blockedSender)).pop();
    if (last) setAnnouncement(t('newMessageFrom', {name: last.sender.name, text: last.hidden ? t('hiddenMessage') : last.deleted ? t('deletedMessage')
      : (last.body || (last.attachment ? t('photo') : '')).slice(0, 200)}));
  }, [markRead, me, room, t]);
  // Re-reads everything from the oldest loaded message on. New messages arrive this way, and so does every change to the
  // ones already shown (edited, deleted, hidden, restored): without the live stream this is the only way to notice them.
  const poll = useCallback(async () => {
    const first = latest.current[0], fresh: ChatMessage[] = [];
    let query = first ? 'from=' + encodeURIComponent(first.id) + '&' : '';
    for (let turn = 0; turn < REFRESH_PAGES; turn++) {
      const page = await chatCall<ChatPage>(base + '/messages?' + query + 'limit=100');
      fresh.push(...page.messages);
      const last = page.messages[page.messages.length - 1];
      if (!first || !page.hasMore || !last) break;
      query = 'after=' + encodeURIComponent(last.id) + '&';
    }
    if (fresh.length) incoming(fresh);
  }, [base, incoming]);
  const onEvent = useCallback((event: ChatEvent) => {
    if (event.type === 'message') incoming([event.message]);
    else if (event.type === 'conversation') void refreshDetail();
    // A restored message is fetched again because the stream never carries hidden text.
    else if (event.type === 'hidden' && !event.hidden) void poll().catch(() => undefined);
    else setMessages(current => applyEvent(current, event));
  }, [incoming, poll, refreshDetail]);
  const mode = useConversationStream({conversationId: id, onEvent, poll});
  useEffect(() => {markRead();}, [markRead]);
  // Keeps the view at the newest message unless the reader scrolled up; loading older messages keeps the reading position.
  const settle = useCallback(() => {
    const box = scroller.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (keep.current !== null) {box.scrollTop = box.scrollHeight - keep.current; keep.current = null;}
    else settle();
  }, [messages, settle]);
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
    setMessages(current => mergeMessages(current, page.messages));
    setHasMore(page.hasMore);
  });
  function choose(next: File | null) {
    setError(''); setFile(null);
    if (!next) return;
    if (!IMAGE_TYPES.includes(next.type)) return setError('MEDIA_TYPE');
    if (next.size > MAX_FILE) return setError('MEDIA_TOO_LARGE');
    setFile(next);
  }
  const clearFile = () => {setFile(null); if (picker.current) picker.current.value = '';};
  const send = () => run('send', async () => {
    const body = text.trim();
    if (!body && !file) return;
    // The image goes through the media pipeline first (checked, re-encoded, metadata removed); the message then names the result.
    const attachmentKey = file ? (await uploadImage(file, 'chat', id)).key : undefined;
    const {message} = await chatCall<{message: ChatMessage}>(base + '/messages', 'POST', {body, attachmentKey});
    stick.current = true;
    setText(''); clearFile();
    setMessages(current => mergeMessages(current, [message]));
    if (detail.requestRemaining !== null) await refreshDetail();
  });
  const toInbox = () => {router.push('/' + locale + '/messages'); router.refresh();};
  const accept = () => run('accept', async () => {await chatCall(base, 'PATCH', {action: 'accept'}); await refreshDetail();});
  const leave = () => run('leave', async () => {await chatCall(base, 'DELETE', {}); toInbox();});
  const block = () => run('block', async () => {await chatCall('/api/chat/blocks', 'PUT', {profileId: detail.other?.id}); if (detail.accepted) await refreshDetail(); else toInbox();});
  const unblock = () => run('block', async () => {await chatCall('/api/chat/blocks', 'DELETE', {profileId: detail.other?.id}); await refreshDetail();});
  const setHidden = (message: ChatMessage, hidden: boolean) => run('hide', async () => {
    await chatCall('/api/chat/messages/' + message.id, 'PATCH', {hidden});
    if (hidden) setMessages(current => applyEvent(current, {type: 'hidden', conversationId: id, messageId: message.id, hidden}));
    else await poll();
  });
  const saveEdit = () => run('edit', async () => {
    if (!editing) return;
    const {message} = await chatCall<{message: ChatMessage}>('/api/chat/messages/' + editing.id, 'PATCH', {body: editing.text});
    setMessages(current => mergeMessages(current, [message]));
    setEditing(null);
  });
  const erase = (message: ChatMessage) => run('delete', async () => {
    await chatCall('/api/chat/messages/' + message.id, 'DELETE', {});
    setMessages(current => applyEvent(current, {type: 'deleted', conversationId: id, messageId: message.id}));
    setConfirming('');
  });
  const invite = (form: HTMLFormElement) => run('invite', async () => {
    await chatCall(base + '/members', 'POST', {handle: String(new FormData(form).get('handle') ?? '')});
    form.reset();
    await refreshDetail();
  });
  const rename = (form: HTMLFormElement) => run('rename', async () => {
    await chatCall(base, 'PATCH', {action: 'rename', title: String(new FormData(form).get('title') ?? '')});
    await refreshDetail();
  });
  const remove = (profileId: string) => run('remove', async () => {await chatCall(base + '/members', 'DELETE', {profileId}); await refreshDetail();});
  const canWrite = detail.accepted && !detail.readOnly && !detail.blockedByMe && detail.requestRemaining !== 0;
  const manages = detail.kind === 'GROUP' && detail.admin && detail.accepted;
  return <div className="chat chat-thread">
    <header className="chat-head">
      <Link className="chat-back" href={'/' + locale + '/messages'}><span aria-hidden="true">←</span> {t('back')}</Link>
      <h1>{title}</h1>
      <p className="chat-sub">
        {room && <span className="chat-kind">{t('kind_' + detail.kind)}</span>}
        {room && <span>{t('memberCount', {count: detail.memberCount})}</span>}
        {detail.kind === 'DIRECT' && detail.other && <Link href={'/' + locale + '/people/' + detail.other.handle}>@{detail.other.handle}</Link>}
        {detail.event && <Link href={'/' + locale + '/events/' + detail.event.slug}>{t('viewEvent')}</Link>}
        {detail.city && <Link href={'/' + locale + '/cities/' + detail.city.slug}>{t('viewCity')}</Link>}
        <span className="chat-status" role="status">{t('status_' + mode)}</span>
      </p>
    </header>
    {school && <p className="chat-banner">{t('schoolBanner', {school: school.name})}</p>}
    {room && <details className="chat-panel">
      <summary>{detail.kind === 'GROUP' ? t('members', {count: detail.members.length}) : t('roomAdmins', {count: detail.members.length})}</summary>
      <ul className="chat-members">{detail.members.map(member => <li key={member.id}>
        <Avatar name={member.name} url={member.avatarUrl}/>
        <span><Link href={'/' + locale + '/people/' + member.handle}>{member.name}</Link> <small>@{member.handle}{member.admin ? ' · ' + t('admin') : ''}{member.accepted ? '' : ' · ' + t('invited')}</small></span>
        {detail.kind === 'GROUP' && detail.admin && member.id !== me &&
          <button type="button" className="button secondary" disabled={!!busy} aria-label={t('removeMember', {name: member.name})} onClick={() => remove(member.id)}>{t('remove')}</button>}
      </li>)}</ul>
      {manages && <form className="chat-form chat-invite" onSubmit={event => {event.preventDefault(); void invite(event.currentTarget);}}>
        <label>{t('inviteLabel')}<input name="handle" required maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false}/></label>
        <button className="button secondary" disabled={!!busy}>{t('inviteButton')}</button>
      </form>}
      {manages && <form className="chat-form chat-invite" key={detail.title} onSubmit={event => {event.preventDefault(); void rename(event.currentTarget);}}>
        <label>{t('renameLabel')}<input name="title" required maxLength={80} defaultValue={detail.title ?? ''} autoComplete="off"/></label>
        <button className="button secondary" disabled={!!busy}>{t('renameButton')}</button>
      </form>}
      {detail.accepted && !school && <button type="button" className="button secondary danger" disabled={!!busy} onClick={leave}>{t('leave')}</button>}
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
        const mine = message.sender.id === me, gone = message.hidden || message.deleted || message.body === null;
        // In groups and rooms a message from somebody the reader blocked stays folded until they ask for it. The sender is never told.
        const folded = room && message.blockedSender && !mine && !revealed.includes(message.id);
        const editable = mine && !gone && canWrite && now > 0 && now - Date.parse(message.createdAt) < EDIT_MS;
        return <li key={message.id} className={'chat-message' + (mine ? ' mine' : '')}>
          <p className="chat-message-meta">
            {folded ? <strong>{t('blockedSender')}</strong> : mine ? <strong>{school ? school.name : t('you')}</strong>
              : <Link href={'/' + locale + '/people/' + message.sender.handle}>{message.sender.name}</Link>}
            <time dateTime={message.createdAt} suppressHydrationWarning>{time.format(new Date(message.createdAt))}</time>
            {message.editedAt && !folded && <span>{t('edited')}</span>}
            {school && mine && <span>{t('sentBySchool')}</span>}
          </p>
          {folded ? <p className="chat-message-body hidden"><em>{t('blockedSenderMessage')}</em></p>
            : message.deleted ? <p className="chat-message-body hidden"><em>{t('deletedMessage')}</em></p>
            : gone ? <p className="chat-message-body hidden"><em>{t('hiddenMessage')}</em></p>
            : editing?.id === message.id ? <form className="chat-form" onSubmit={event => {event.preventDefault(); void saveEdit();}}>
              <label>{t('editLabel')}<textarea rows={2} maxLength={MAX} value={editing.text} autoFocus
                onChange={event => setEditing({id: message.id, text: event.target.value})}
                onKeyDown={event => {if (event.key === 'Escape') setEditing(null);}}/></label>
              <div className="chat-actions">
                <button className="button" disabled={!!busy || (!editing.text.trim() && !message.attachment)}>{t(busy === 'edit' ? 'saving' : 'save')}</button>
                <button type="button" className="button secondary" disabled={!!busy} onClick={() => setEditing(null)}>{t('cancel')}</button>
              </div>
            </form>
            : <>
              {message.body && <p className="chat-message-body"><MessageBody text={message.body}/></p>}
              {message.attachment && <picture className="media-picture">
                <source type="image/avif" srcSet={message.attachment.avif} sizes={SIZES}/>
                <source type="image/webp" srcSet={message.attachment.webp} sizes={SIZES}/>
                <img src={message.attachment.src} alt={t('attachmentAlt', {name: message.sender.name})} loading="lazy" decoding="async" onLoad={settle}/>
              </picture>}
            </>}
          <div className="chat-message-actions">
            {folded && <button type="button" className="report-link" onClick={() => setRevealed(current => [...current, message.id])}>{t('showBlocked')}</button>}
            {/* Reporting goes to the platform moderators; hiding is the room admin's own tool. */}
            {!mine && !gone && !folded && <ReportButton targetType="MESSAGE" targetId={message.id} signedIn/>}
            {editable && editing?.id !== message.id && <button type="button" className="report-link" disabled={!!busy}
              onClick={() => {setConfirming(''); setEditing({id: message.id, text: message.body ?? ''});}}>{t('edit')}</button>}
            {mine && !message.deleted && (confirming === message.id ? <>
              <span role="status">{t('deleteConfirm')}</span>
              <button type="button" className="report-link" disabled={!!busy} onClick={() => erase(message)}>{t('deleteYes')}</button>
              <button type="button" className="report-link" disabled={!!busy} onClick={() => setConfirming('')}>{t('cancel')}</button>
            </> : <button type="button" className="report-link" disabled={!!busy} onClick={() => {setEditing(null); setConfirming(message.id);}}>{t('delete')}</button>)}
            {detail.canModerate && !message.deleted && <button type="button" className="report-link" disabled={!!busy} onClick={() => setHidden(message, !message.hidden)}>{t(message.hidden ? 'unhide' : 'hide')}</button>}
          </div>
        </li>;
      })}</ol> : <p className="chat-empty">{t('noMessagesYet')}</p>}
    </div>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    {error && <p role="alert" className="form-error">{errorText(error)}</p>}
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
      <button className="button" disabled={busy === 'send' || (!text.trim() && !file)}>{t(busy === 'send' ? 'sending' : 'send')}</button>
      <small id="chat-text-hint">{t('composerHint')} · {t('charsLeft', {count: MAX - text.length})}</small>
    </form>}
    {canWrite && detail.canAttach && <div className="chat-form">
      <label htmlFor="chat-file">{t('attachLabel')}
        <input ref={picker} id="chat-file" type="file" accept={IMAGE_TYPES.join(',')} disabled={busy === 'send'} aria-describedby="chat-file-hint"
          onChange={event => choose(event.target.files?.[0] || null)}/>
        <small id="chat-file-hint">{tm('uploadHint', {size: Math.floor(MAX_FILE / 1024 / 1024)})} {t('attachHint')}</small>
      </label>
      <p className="chat-status" role="status">{busy === 'send' && file ? t('attachmentUploading') : file ? t('attachmentReady', {name: file.name}) : ''}</p>
      {file && busy !== 'send' && <button type="button" className="report-link" onClick={clearFile}>{t('attachmentRemove')}</button>}
    </div>}
    {detail.kind === 'DIRECT' && detail.accepted && !detail.blockedByMe && detail.other && <div className="chat-actions chat-foot">
      <button type="button" className="report-link" disabled={!!busy} onClick={block}>{t('block')}</button>
      <button type="button" className="report-link" disabled={!!busy} onClick={leave}>{t('leaveDirect')}</button>
    </div>}
  </div>;
}
