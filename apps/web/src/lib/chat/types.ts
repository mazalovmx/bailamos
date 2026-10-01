// Shapes shared by the chat API and the client. Profiles are reduced to public fields: no email, no coordinates.
export type ChatKind = 'DIRECT' | 'GROUP' | 'EVENT' | 'CITY';
export type ChatProfile = {id: string; handle: string; name: string; avatarUrl: string | null};
// Same-origin, member-checked URLs of the one image a message may carry; storage keys never reach the client.
export type ChatAttachment = {src: string; avif: string; webp: string};
export type ChatMessage = {
  id: string; conversationId: string; createdAt: string; sender: ChatProfile;
  /** Null for a hidden or deleted message; may be empty when the message is only an image. */
  body: string | null; attachment: ChatAttachment | null;
  hidden: boolean; deleted: boolean; editedAt: string | null;
  /** The reader blocked the sender: group and room threads collapse the message. Set per reader, never shown to the sender. */
  blockedSender: boolean;
};
export type ChatSchool = {id: string; name: string};
export type ChatSummary = {
  id: string; kind: ChatKind; title: string | null; other: ChatProfile | null;
  event: {slug: string; title: string} | null; city: {slug: string; name: string} | null;
  /** Set when the reader opens a school's conversation as one of the school's managers. */
  school: ChatSchool | null;
  accepted: boolean; admin: boolean; unread: number; memberCount: number; updatedAt: string;
  lastMessage: {body: string | null; hidden: boolean; deleted: boolean; attachment: boolean; blockedSender: boolean; senderName: string; mine: boolean;
    createdAt: string} | null;
};
export type ChatMember = ChatProfile & {admin: boolean; accepted: boolean};
export type ChatDetail = ChatSummary & {
  members: ChatMember[]; readOnly: boolean; canModerate: boolean; blockedByMe: boolean;
  /** Whether the reader silenced notifications here; null when they have no membership of their own (school managers). */
  muted: boolean | null;
  // Set for the sender of a direct request that is still waiting: messages left before the recipient answers.
  requestRemaining: number | null;
  /** The profile the reader writes as here: their own, or the school's when they manage it. */
  actingProfileId: string;
  canAttach: boolean;
};
export type ChatPage = {messages: ChatMessage[]; hasMore: boolean};
export type ChatInbox = {conversations: ChatSummary[]; requests: ChatSummary[]; school: ChatSummary[]};
export type ChatUnread = {total: number; conversations: number; requests: number};
export type ChatEvent =
  | {type: 'message'; conversationId: string; message: ChatMessage}
  | {type: 'edited'; conversationId: string; message: ChatMessage}
  | {type: 'deleted'; conversationId: string; messageId: string}
  | {type: 'hidden'; conversationId: string; messageId: string; hidden: boolean}
  | {type: 'conversation'; conversationId: string};
export const chatEventTypes = ['message', 'edited', 'deleted', 'hidden', 'conversation'] as const;
