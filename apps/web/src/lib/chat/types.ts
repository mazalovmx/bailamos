// Shapes shared by the chat API and the client. Profiles are reduced to public fields: no email, no coordinates.
export type ChatKind = 'DIRECT' | 'GROUP' | 'EVENT' | 'CITY';
export type ChatProfile = {id: string; handle: string; name: string; avatarUrl: string | null};
export type ChatMessage = {id: string; conversationId: string; createdAt: string; hidden: boolean; body: string | null; sender: ChatProfile};
export type ChatSummary = {
  id: string; kind: ChatKind; title: string | null; other: ChatProfile | null;
  event: {slug: string; title: string} | null; city: {slug: string; name: string} | null;
  accepted: boolean; admin: boolean; unread: number; memberCount: number; updatedAt: string;
  lastMessage: {body: string | null; hidden: boolean; senderName: string; mine: boolean; createdAt: string} | null;
};
export type ChatMember = ChatProfile & {admin: boolean; accepted: boolean};
export type ChatDetail = ChatSummary & {
  members: ChatMember[]; readOnly: boolean; canModerate: boolean; blockedByMe: boolean;
  // Set for the sender of a direct request that is still waiting: messages left before the recipient answers.
  requestRemaining: number | null;
};
export type ChatPage = {messages: ChatMessage[]; hasMore: boolean};
export type ChatInbox = {conversations: ChatSummary[]; requests: ChatSummary[]};
export type ChatUnread = {total: number; conversations: number; requests: number};
export type ChatEvent =
  | {type: 'message'; conversationId: string; message: ChatMessage}
  | {type: 'hidden'; conversationId: string; messageId: string; hidden: boolean}
  | {type: 'conversation'; conversationId: string};
