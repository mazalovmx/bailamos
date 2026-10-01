import type {ChatEvent, ChatMessage} from './types';
// Pure thread state: used by the client for live events and for polled pages alike, so both paths end in the same list.
const order = (a: ChatMessage, b: ChatMessage) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/** Adds new messages and replaces known ones with their latest state (edited, hidden, restored, deleted). */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(order);
}
const blank = (message: ChatMessage, state: Partial<ChatMessage>): ChatMessage => ({...message, body: null, attachment: null, editedAt: null, ...state});
/**
 * Applies one live event. Text and image of a hidden or deleted message are dropped at once. A restored message
 * (hidden: false) cannot be rebuilt from the event, because the stream never carries hidden text: the caller re-reads the thread.
 */
export function applyEvent(messages: ChatMessage[], event: ChatEvent): ChatMessage[] {
  if (event.type === 'message' || event.type === 'edited') return mergeMessages(messages, [event.message]);
  if (event.type === 'deleted') return messages.map(message => message.id === event.messageId ? blank(message, {deleted: true}) : message);
  if (event.type === 'hidden' && event.hidden) return messages.map(message => message.id === event.messageId ? blank(message, {hidden: true}) : message);
  return messages;
}
