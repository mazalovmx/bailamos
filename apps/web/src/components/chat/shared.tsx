'use client';
import {linkify, LINK_REL} from '../../lib/chat/linkify';
import type {ChatSummary} from '../../lib/chat/types';
type Translate = {(key: string, values?: Record<string, string | number>): string; has(key: string): boolean};
/** Calls a chat endpoint and throws an Error whose message is the API error code. */
export async function chatCall<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {method, cache: 'no-store',
    ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'GENERIC');
  return data as T;
}
export const errorCode = (failure: unknown) => failure instanceof Error && /^[A-Z_]+$/.test(failure.message) ? failure.message : 'GENERIC';
export function ChatError({code, t}: {code: string; t: Translate}) {
  return code ? <p role="alert" className="form-error">{t.has('error_' + code) ? t('error_' + code) : t('error_GENERIC')}</p> : null;
}
export function conversationTitle(t: Translate, conversation: Pick<ChatSummary, 'kind' | 'title' | 'other' | 'event' | 'city'>) {
  if (conversation.kind === 'DIRECT') return conversation.other?.name ?? t('deletedProfile');
  if (conversation.kind === 'EVENT') return t('eventRoomTitle', {title: conversation.event?.title ?? ''});
  if (conversation.kind === 'CITY') return t('cityRoomTitle', {city: conversation.city?.name ?? ''});
  return conversation.title || t('group');
}
// Message text is rendered as React text nodes; only http(s) URLs found by the linkifier become anchors.
export function MessageBody({text}: {text: string}) {
  return <>{linkify(text).map((part, index) => part.type === 'link'
    ? <a key={index} href={part.href} rel={LINK_REL} target="_blank">{part.value}</a> : <span key={index}>{part.value}</span>)}</>;
}
export function Avatar({name, url}: {name: string; url: string | null}) {
  // Decorative: the name is always printed next to it.
  return url ? <img className="chat-avatar" src={url} alt="" width={40} height={40} loading="lazy"/> :
    <span className="chat-avatar" aria-hidden="true">{[...name.trim()][0]?.toUpperCase() ?? '?'}</span>;
}
