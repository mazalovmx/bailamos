import {db} from '@dance/db';
/**
 * The chat part of the "download my data" export: only what the user wrote or set themselves.
 * Other members' messages, names, emails and locations are deliberately left out.
 */
export async function chatExport(userId: string) {
  const profile = await db.profile.findUnique({where: {userId}, select: {id: true}});
  if (!profile) return {messages: [], conversations: [], blocks: []};
  const [messages, conversations, blocks] = await Promise.all([
    db.message.findMany({where: {senderProfileId: profile.id}, orderBy: {createdAt: 'asc'},
      select: {id: true, conversationId: true, body: true, hiddenAt: true, createdAt: true}}),
    db.conversationMember.findMany({where: {profileId: profile.id}, orderBy: {joinedAt: 'asc'}, select: {conversationId: true, admin: true, accepted: true,
      lastReadAt: true, joinedAt: true, conversation: {select: {kind: true, title: true, eventId: true, cityId: true}}}}),
    db.block.findMany({where: {blockerProfileId: profile.id}, orderBy: {createdAt: 'asc'}, select: {blockedProfileId: true, createdAt: true}})]);
  return {messages, conversations: conversations.map(({conversation, ...member}) => ({...member, ...conversation})), blocks};
}
export type ChatExport = Awaited<ReturnType<typeof chatExport>>;
