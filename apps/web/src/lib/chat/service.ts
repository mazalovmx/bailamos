import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {notify} from '../notify';
import {rateLimit, type RateLimitOptions} from '../rate-limit';
import {mediaUrl} from '../account/media';
import {directKey, directPeer, isBlockedBetween, isKnownTo, limits, requestMessageLimit, requestRemaining} from './policy';
import {claimNotification, conversationChannel, onlineProfiles, profileChannel, publish, releaseNotification} from './realtime';
import type {ChatDetail, ChatInbox, ChatMember, ChatMessage, ChatPage, ChatProfile, ChatSummary, ChatUnread} from './types';
// The signed-in member as chat sees them. Built by chatActor()/chatViewer() in ./http.
export type Me = {userId: string; profileId: string; role: string; name: string};
type Tx = Prisma.TransactionClient;
const profileSelect = {id: true, handle: true, name: true, avatarKey: true} as const;
type ProfileRow = {id: string; handle: string; name: string; avatarKey: string | null};
const toProfile = (row: ProfileRow): ChatProfile => ({id: row.id, handle: row.handle, name: row.name, avatarUrl: row.avatarKey ? mediaUrl(row.avatarKey) : null});
type MessageRow = {id: string; conversationId: string; body: string; hiddenAt: Date | null; createdAt: Date; sender: ProfileRow};
// A hidden message never leaves the server: every reader, including the room admin, gets a placeholder.
const toMessage = (row: MessageRow): ChatMessage => ({id: row.id, conversationId: row.conversationId, createdAt: row.createdAt.toISOString(),
  hidden: !!row.hiddenAt, body: row.hiddenAt ? null : row.body, sender: toProfile(row.sender)});
const fail = (code: string, status: number) => new ApiError(code, status);
const notFound = () => fail('NOT_FOUND', 404);
async function limit(key: string, options: RateLimitOptions) {
  if (!(await rateLimit(key, options)).ok) throw fail('RATE_LIMITED', 429);
}
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
// Control and bidirectional-override characters are dropped so a message cannot disguise its text or break the layout.
// eslint-disable-next-line no-control-regex
const clean = (value: string) => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
  .replace(/\n{3,}/g, '\n\n').trim();
export const messageBody = z.string().max(8000).transform(clean).pipe(z.string().min(1).max(limits.bodyMax));
export const messageInput = z.object({body: messageBody});
export const profileInput = z.object({profileId: z.string().min(1).max(40)});
const handle = z.string().trim().toLowerCase().transform(value => value.replace(/^@/, '')).pipe(z.string().min(1).max(40));
export const inviteInput = z.object({handle});
export const groupInput = z.object({title: z.string().transform(clean).pipe(z.string().min(1).max(limits.titleMax)), handles: z.array(handle).max(20).default([])});
export const roomInput = z.union([z.object({eventId: z.string().min(1).max(40)}).strict(), z.object({cityId: z.string().min(1).max(40)}).strict()]);
export const removeInput = z.object({profileId: z.string().min(1).max(40).optional()});
export const pageInput = z.object({before: z.string().min(1).max(40).optional(), after: z.string().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(limits.pageMax).default(limits.pageSize)}).refine(value => !(value.before && value.after));
const isOpen = (event: {status: string; hiddenAt: Date | null}) => event.status === 'PUBLISHED' && !event.hiddenAt;
/** Organizers and members with a GOING or INTERESTED RSVP may use an event room; everybody else gets null. */
export async function eventRoomRole(eventId: string, profileId: string, client: Tx = db): Promise<'organizer' | 'attendee' | null> {
  const [organizer, rsvp] = await Promise.all([
    client.eventMembership.findFirst({where: {eventId, profileId, role: {in: ['OWNER', 'CO_ORGANIZER']}}, select: {role: true}}),
    client.rsvp.findFirst({where: {eventId, profileId, status: {in: ['GOING', 'INTERESTED']}}, select: {status: true}})]);
  return organizer ? 'organizer' : rsvp ? 'attendee' : null;
}
const conversationInclude = {event: {select: {id: true, slug: true, title: true, status: true, hiddenAt: true}}, city: {select: {slug: true, name: true}}} as const;
/**
 * The single membership gate: every read and every write of a conversation goes through it. A conversation the caller is not
 * a member of is reported as NOT_FOUND, exactly like one that does not exist, so ids cannot be probed.
 */
export async function access(me: Me, conversationId: string, write = false) {
  const member = await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: me.profileId}},
    include: {conversation: {include: conversationInclude}}});
  if (!member) throw notFound();
  const conversation = member.conversation;
  let admin = member.admin, readOnly = false;
  if (conversation.kind === 'EVENT') {
    const event = conversation.event, role = event && await eventRoomRole(event.id, me.profileId);
    if (!event || !role) {
      // The RSVP was withdrawn or the organizer role removed: the room is closed for this member from now on.
      await db.conversationMember.deleteMany({where: {conversationId, profileId: me.profileId}});
      throw notFound();
    }
    if (admin !== (role === 'organizer')) {
      admin = role === 'organizer';
      await db.conversationMember.updateMany({where: {conversationId, profileId: me.profileId}, data: {admin}});
    }
    readOnly = !isOpen(event);
  }
  if (write) {
    if (!member.accepted) throw fail('REQUEST_NOT_ACCEPTED', 403);
    if (readOnly) throw fail('ROOM_READ_ONLY', 403);
  }
  const canModerate = conversation.kind !== 'DIRECT' && (admin || (me.role !== 'USER' && (conversation.kind === 'EVENT' || conversation.kind === 'CITY')));
  return {member, conversation, admin, readOnly, canModerate};
}
// ---------- Direct conversations and requests ----------
export async function openDirect(me: Me, profileId: string) {
  if (profileId === me.profileId) throw fail('CHAT_SELF', 400);
  const target = await db.profile.findFirst({where: {id: profileId, hiddenAt: null, userId: {not: null}, user: {bannedAt: null}}, select: {id: true}});
  // One answer for "no such member", "profile without an owner" and "blocked in either direction".
  if (!target || await isBlockedBetween(me.profileId, profileId)) throw fail('CHAT_UNAVAILABLE', 403);
  const key = directKey(me.profileId, profileId), now = new Date();
  let conversation = await db.conversation.findUnique({where: {directKey: key}, select: {id: true, members: {select: {profileId: true}}}});
  if (!conversation) {
    await limit('chat:direct:' + me.userId, limits.newDirect);
    const known = await isKnownTo(me.profileId, profileId);
    try {
      const created = await db.conversation.create({data: {kind: 'DIRECT', directKey: key, members: {create: [
        {profileId: me.profileId, accepted: true, joinedAt: now, lastReadAt: now}, {profileId, accepted: known, joinedAt: now}]}}, select: {id: true}});
      return {id: created.id, created: true};
    } catch (error) {
      if (!isUnique(error)) throw error;
      conversation = await db.conversation.findUnique({where: {directKey: key}, select: {id: true, members: {select: {profileId: true}}}});
      if (!conversation) throw error;
    }
  }
  // Reaching out after having declined or left counts as accepting the conversation.
  if (!conversation.members.some(member => member.profileId === me.profileId))
    await db.conversationMember.createMany({data: [{conversationId: conversation.id, profileId: me.profileId, accepted: true, joinedAt: now, lastReadAt: now}], skipDuplicates: true});
  return {id: conversation.id, created: false};
}
export async function sendMessage(me: Me, conversationId: string, rawBody: unknown) {
  const body = messageBody.parse(rawBody);
  const {conversation} = await access(me, conversationId, true);
  let peer: string | null = null, pending = false;
  if (conversation.kind === 'DIRECT') {
    peer = conversation.directKey ? directPeer(conversation.directKey, me.profileId) : null;
    if (!peer || await isBlockedBetween(me.profileId, peer)) throw fail('CHAT_UNAVAILABLE', 403);
    const other = await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: peer}}, select: {accepted: true}});
    pending = !other?.accepted;
  }
  await limit('chat:send:' + me.userId, limits.send);
  if (pending) await limit('chat:request:' + me.userId, limits.requestSend);
  const now = new Date();
  let readded = false;
  const write = async (tx: Tx) => {
    const row = await tx.message.create({data: {conversationId, senderProfileId: me.profileId, body, createdAt: now}, include: {sender: {select: profileSelect}}});
    await tx.conversation.update({where: {id: conversationId}, data: {updatedAt: now}});
    await tx.conversationMember.updateMany({where: {conversationId, profileId: me.profileId}, data: {lastReadAt: now}});
    return row;
  };
  const row = await db.$transaction(async tx => {
    if (!pending || !peer) return write(tx);
    // Serialised per sender and conversation, so parallel requests cannot slip past the request limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chat-request:' + conversationId + ':' + me.profileId}))`;
    const other = await tx.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: peer}}, select: {accepted: true}});
    if (!other?.accepted) {
      // The count never resets: a declined request cannot be repeated beyond the same limit.
      const sent = await tx.message.count({where: {conversationId, senderProfileId: me.profileId}});
      if (!requestRemaining(sent)) throw fail('REQUEST_LIMIT', 403);
      if (!other) {
        if (!await tx.profile.findFirst({where: {id: peer, userId: {not: null}}, select: {id: true}})) throw fail('CHAT_UNAVAILABLE', 403);
        await tx.conversationMember.create({data: {conversationId, profileId: peer, accepted: false, joinedAt: new Date(now.getTime() - 1)}});
        readded = true;
      }
    }
    return write(tx);
  });
  const message = toMessage(row);
  await publish(conversationChannel(conversationId), {type: 'message', conversationId, message});
  if (peer && (readded || pending)) await publish(profileChannel(peer), {type: 'conversation', conversationId});
  await notifyMembers(me, conversationId, conversation.kind, message).catch(() => undefined);
  return message;
}
// One unread CHAT_MESSAGE notification per conversation and recipient, and none for members who are watching the stream.
async function notifyMembers(me: Me, conversationId: string, kind: string, message: ChatMessage) {
  const members = await db.conversationMember.findMany({where: {conversationId, profileId: {not: me.profileId}, profile: {userId: {not: null}},
    ...(kind === 'DIRECT' ? {} : {accepted: true})}, select: {profileId: true, profile: {select: {userId: true}}}, take: 5000});
  if (!members.length) return;
  const profileIds = members.map(member => member.profileId);
  const [online, blockers] = await Promise.all([onlineProfiles(profileIds),
    db.block.findMany({where: {blockedProfileId: me.profileId, blockerProfileId: {in: profileIds}}, select: {blockerProfileId: true}})]);
  const muted = new Set(blockers.map(block => block.blockerProfileId));
  let userIds = members.filter(member => !online.has(member.profileId) && !muted.has(member.profileId)).map(member => member.profile.userId as string);
  if (!userIds.length) return;
  const unread = await db.notification.findMany({where: {userId: {in: userIds}, type: 'CHAT_MESSAGE', readAt: null,
    data: {path: ['conversationId'], equals: conversationId}}, select: {userId: true}});
  const has = new Set(unread.map(row => row.userId));
  userIds = userIds.filter(userId => !has.has(userId));
  const claimed = await Promise.all(userIds.map(userId => claimNotification(conversationId, userId)));
  userIds = userIds.filter((_, index) => claimed[index]);
  await notify(userIds, 'CHAT_MESSAGE', {conversationId, senderName: message.sender.name, preview: (message.body ?? '').slice(0, 120)}, '/messages/' + conversationId);
}
export async function listMessages(me: Me, conversationId: string, input: z.input<typeof pageInput> = {}): Promise<ChatPage> {
  const {before, after, limit: size} = pageInput.parse(input);
  await access(me, conversationId);
  const cursorId = before ?? after;
  // The cursor must be a message of this very conversation; otherwise it could be used to probe foreign ids.
  if (cursorId && !await db.message.findFirst({where: {id: cursorId, conversationId}, select: {id: true}})) throw fail('INVALID_INPUT', 400);
  const direction = after ? 'asc' as const : 'desc' as const;
  const rows = await db.message.findMany({where: {conversationId}, orderBy: [{createdAt: direction}, {id: direction}], take: size + 1,
    ...(cursorId ? {cursor: {id: cursorId}, skip: 1} : {}), include: {sender: {select: profileSelect}}});
  const hasMore = rows.length > size, page = rows.slice(0, size);
  return {messages: (after ? page : page.reverse()).map(toMessage), hasMore};
}
export async function markRead(me: Me, conversationId: string) {
  await access(me, conversationId);
  await db.conversationMember.updateMany({where: {conversationId, profileId: me.profileId}, data: {lastReadAt: new Date()}});
  await db.notification.updateMany({where: {userId: me.userId, type: 'CHAT_MESSAGE', readAt: null, data: {path: ['conversationId'], equals: conversationId}},
    data: {readAt: new Date()}});
  await releaseNotification(conversationId, me.userId);
}
export async function acceptConversation(me: Me, conversationId: string) {
  const {conversation} = await access(me, conversationId);
  if (conversation.kind === 'DIRECT') {
    const peer = conversation.directKey ? directPeer(conversation.directKey, me.profileId) : null;
    if (!peer || await isBlockedBetween(me.profileId, peer)) throw fail('CHAT_UNAVAILABLE', 403);
  }
  await db.conversationMember.updateMany({where: {conversationId, profileId: me.profileId}, data: {accepted: true}});
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
}
// Leaving a direct conversation declines it. The conversation row stays, so the request limit of the other side is not reset.
export async function leaveConversation(me: Me, conversationId: string, targetProfileId?: string) {
  const {conversation, admin} = await access(me, conversationId);
  const target = targetProfileId && targetProfileId !== me.profileId ? targetProfileId : me.profileId;
  if (target !== me.profileId && (conversation.kind !== 'GROUP' || !admin)) throw fail('FORBIDDEN', 403);
  const removed = await db.conversationMember.deleteMany({where: {conversationId, profileId: target}});
  if (!removed.count) throw notFound();
  if (conversation.kind === 'GROUP') {
    const rest = await db.conversationMember.findMany({where: {conversationId}, orderBy: [{accepted: 'desc'}, {joinedAt: 'asc'}], select: {profileId: true, admin: true}});
    if (!rest.length) await db.conversation.deleteMany({where: {id: conversationId, kind: 'GROUP'}});
    else if (!rest.some(member => member.admin))
      await db.conversationMember.updateMany({where: {conversationId, profileId: rest[0].profileId}, data: {admin: true, accepted: true}});
  }
  await publish(profileChannel(target), {type: 'conversation', conversationId});
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
}
// ---------- Blocks ----------
export async function blockProfile(me: Me, profileId: string) {
  if (profileId === me.profileId) throw fail('INVALID_INPUT', 400);
  if (!await db.profile.findUnique({where: {id: profileId}, select: {id: true}})) throw notFound();
  await db.block.createMany({data: [{blockerProfileId: me.profileId, blockedProfileId: profileId}], skipDuplicates: true});
  // A block also withdraws partner interest in both directions, as blocking from partner search does.
  await db.partnerInterest.deleteMany({where: {OR: [{fromProfileId: me.profileId, toProfileId: profileId}, {fromProfileId: profileId, toProfileId: me.profileId}]}});
  return {blocked: true};
}
export async function unblockProfile(me: Me, profileId: string) {
  await db.block.deleteMany({where: {blockerProfileId: me.profileId, blockedProfileId: profileId}});
  return {blocked: false};
}
export async function listBlocks(me: Me): Promise<ChatProfile[]> {
  const rows = await db.block.findMany({where: {blockerProfileId: me.profileId}, orderBy: {createdAt: 'desc'}, select: {blocked: {select: profileSelect}}});
  return rows.map(row => toProfile(row.blocked));
}
// ---------- Rooms and groups ----------
export async function joinRoom(me: Me, input: z.infer<typeof roomInput>) {
  const now = new Date();
  if ('eventId' in input) {
    const event = await db.event.findUnique({where: {id: input.eventId}, select: {id: true, status: true, hiddenAt: true}});
    if (!event || !isOpen(event)) throw notFound();
    const role = await eventRoomRole(event.id, me.profileId);
    if (!role) throw fail('ROOM_NOT_ELIGIBLE', 403);
    const room = await lazyRoom({eventId: event.id}, {kind: 'EVENT', eventId: event.id});
    await db.conversationMember.upsert({where: {conversationId_profileId: {conversationId: room.id, profileId: me.profileId}},
      create: {conversationId: room.id, profileId: me.profileId, admin: role === 'organizer', joinedAt: now, lastReadAt: now}, update: {admin: role === 'organizer', accepted: true}});
    return {id: room.id};
  }
  if (!await db.city.findUnique({where: {id: input.cityId}, select: {id: true}})) throw notFound();
  const room = await lazyRoom({cityId: input.cityId}, {kind: 'CITY', cityId: input.cityId});
  await db.conversationMember.upsert({where: {conversationId_profileId: {conversationId: room.id, profileId: me.profileId}},
    create: {conversationId: room.id, profileId: me.profileId, joinedAt: now, lastReadAt: now}, update: {accepted: true}});
  return {id: room.id};
}
async function lazyRoom(where: {eventId: string} | {cityId: string}, data: Prisma.ConversationUncheckedCreateInput) {
  const existing = await db.conversation.findUnique({where, select: {id: true}});
  if (existing) return existing;
  try {return await db.conversation.create({data, select: {id: true}});} catch (error) {
    // Two members opening a new room at the same moment meet on the unique index; the loser reads the winner's row.
    const row = isUnique(error) ? await db.conversation.findUnique({where, select: {id: true}}) : null;
    if (!row) throw error;
    return row;
  }
}
async function invitee(me: Me, profileHandle: string) {
  const profile = await db.profile.findFirst({where: {handle: profileHandle, hiddenAt: null, userId: {not: null}, user: {bannedAt: null}}, select: {id: true}});
  // Unknown handle, ownerless profile and a block in either direction look the same to the inviter.
  if (!profile || profile.id === me.profileId || await isBlockedBetween(me.profileId, profile.id)) throw fail('CANNOT_INVITE', 403);
  return profile.id;
}
// Invitations from strangers are requests too: the invited member has to accept before the group shows up among conversations.
async function addMember(me: Me, conversationId: string, profileId: string) {
  const accepted = await isKnownTo(me.profileId, profileId);
  const result = await db.conversationMember.createMany({data: [{conversationId, profileId, accepted, joinedAt: new Date()}], skipDuplicates: true});
  if (!result.count) throw fail('ALREADY_MEMBER', 409);
  await publish(profileChannel(profileId), {type: 'conversation', conversationId});
}
export async function createGroup(me: Me, raw: unknown) {
  const {title, handles} = groupInput.parse(raw);
  await limit('chat:group:' + me.userId, limits.newGroup);
  const now = new Date();
  const group = await db.conversation.create({data: {kind: 'GROUP', title,
    members: {create: [{profileId: me.profileId, admin: true, accepted: true, joinedAt: now, lastReadAt: now}]}}, select: {id: true}});
  let invited = 0, skipped = 0;
  for (const profileHandle of [...new Set(handles)]) {
    try {await addMember(me, group.id, await invitee(me, profileHandle)); invited++;} catch (error) {
      if (!(error instanceof ApiError)) throw error;
      skipped++;
    }
  }
  return {id: group.id, invited, skipped};
}
export async function inviteMember(me: Me, conversationId: string, raw: unknown) {
  const {handle: profileHandle} = inviteInput.parse(raw);
  const {conversation, admin} = await access(me, conversationId, true);
  if (conversation.kind !== 'GROUP' || !admin) throw fail('FORBIDDEN', 403);
  await limit('chat:invite:' + me.userId, limits.invite);
  if (await db.conversationMember.count({where: {conversationId}}) >= limits.groupMembers) throw fail('GROUP_FULL', 409);
  const profileId = await invitee(me, profileHandle);
  await addMember(me, conversationId, profileId);
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
  return {profileId};
}
// ---------- Moderation inside a room ----------
export async function setMessageHidden(me: Me, messageId: string, hidden: boolean) {
  const message = await db.message.findUnique({where: {id: messageId}, select: {id: true, conversationId: true}});
  if (!message) throw notFound();
  const {canModerate} = await access(me, message.conversationId);
  if (!canModerate) throw fail('FORBIDDEN', 403);
  await db.$transaction([
    db.message.update({where: {id: messageId}, data: {hiddenAt: hidden ? new Date() : null}}),
    db.auditLog.create({data: {actorUserId: me.userId, action: hidden ? 'CHAT_MESSAGE_HIDE' : 'CHAT_MESSAGE_UNHIDE', targetType: 'Message', targetId: messageId,
      data: {conversationId: message.conversationId}}})]);
  await publish(conversationChannel(message.conversationId), {type: 'hidden', conversationId: message.conversationId, messageId, hidden});
  return {id: messageId, hidden};
}
// ---------- Inbox, detail and unread counters ----------
async function unreadMap(profileId: string) {
  const rows = await db.$queryRaw<{conversationId: string; count: number}[]>`
    SELECT m."conversationId", count(x.id)::int AS count FROM "ConversationMember" m
    JOIN "Message" x ON x."conversationId" = m."conversationId" AND x."createdAt" > COALESCE(m."lastReadAt", m."joinedAt")
      AND x."senderProfileId" <> m."profileId" AND x."hiddenAt" IS NULL
    WHERE m."profileId" = ${profileId} GROUP BY m."conversationId"`;
  return new Map(rows.map(row => [row.conversationId, Number(row.count)]));
}
const blockedByMe = async (profileId: string) =>
  new Set((await db.block.findMany({where: {blockerProfileId: profileId}, select: {blockedProfileId: true}})).map(row => row.blockedProfileId));
async function summaries(me: Me, conversationId?: string) {
  const rows = await db.conversationMember.findMany({where: {profileId: me.profileId, ...(conversationId ? {conversationId} : {})},
    orderBy: {conversation: {updatedAt: 'desc'}}, take: 200,
    include: {conversation: {include: {...conversationInclude, _count: {select: {members: true}},
      messages: {orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 1, include: {sender: {select: profileSelect}}}}}}});
  const peerIds = rows.flatMap(row => row.conversation.kind === 'DIRECT' && row.conversation.directKey ? [directPeer(row.conversation.directKey, me.profileId) ?? ''] : []);
  const [peers, unread, blocked] = await Promise.all([
    peerIds.length ? db.profile.findMany({where: {id: {in: peerIds}}, select: profileSelect}) : [], unreadMap(me.profileId), blockedByMe(me.profileId)]);
  const peerById = new Map(peers.map(peer => [peer.id, peer]));
  return rows.map(row => {
    const conversation = row.conversation, last = conversation.messages[0];
    const peerId = conversation.kind === 'DIRECT' && conversation.directKey ? directPeer(conversation.directKey, me.profileId) : null;
    const peer = peerId ? peerById.get(peerId) : undefined;
    const summary: ChatSummary = {id: conversation.id, kind: conversation.kind, title: conversation.title, other: peer ? toProfile(peer) : null,
      event: conversation.event && {slug: conversation.event.slug, title: conversation.event.title}, city: conversation.city,
      accepted: row.accepted, admin: row.admin, unread: unread.get(conversation.id) ?? 0, memberCount: conversation._count.members,
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessage: last ? {body: last.hiddenAt ? null : last.body.slice(0, 160), hidden: !!last.hiddenAt, senderName: last.sender.name,
        mine: last.senderProfileId === me.profileId, createdAt: last.createdAt.toISOString()} : null};
    return {summary, peerId, blocked: !!peerId && blocked.has(peerId), event: conversation.event};
  });
}
export async function inbox(me: Me): Promise<ChatInbox> {
  // Direct conversations with somebody the viewer blocked, with a deleted profile or without any message stay out of the inbox.
  const visible = (await summaries(me)).filter(row => row.summary.kind !== 'DIRECT' || (row.summary.other && !row.blocked && row.summary.lastMessage));
  return {conversations: visible.filter(row => row.summary.accepted).map(row => row.summary),
    requests: visible.filter(row => !row.summary.accepted).map(row => row.summary)};
}
export async function unreadCounts(me: Me): Promise<ChatUnread> {
  const [rows, unread, blocked] = await Promise.all([
    db.conversationMember.findMany({where: {profileId: me.profileId}, select: {conversationId: true, accepted: true, conversation: {select: {kind: true, directKey: true}}}}),
    unreadMap(me.profileId), blockedByMe(me.profileId)]);
  const result = {total: 0, conversations: 0, requests: 0};
  for (const row of rows) {
    const peer = row.conversation.kind === 'DIRECT' && row.conversation.directKey ? directPeer(row.conversation.directKey, me.profileId) : null;
    if (peer && blocked.has(peer)) continue;
    const count = unread.get(row.conversationId) ?? 0;
    if (!row.accepted) {if (count || row.conversation.kind !== 'DIRECT') result.requests++;}
    else if (count) {result.total += count; result.conversations++;}
  }
  return result;
}
export async function conversationDetail(me: Me, conversationId: string): Promise<ChatDetail> {
  const {conversation, admin, readOnly, canModerate} = await access(me, conversationId);
  const [row] = await summaries(me, conversationId);
  if (!row) throw notFound();
  // Room member lists stay private (an event may hide its attendees); only the admins of a room are shown.
  const memberRows = conversation.kind === 'DIRECT' ? [] : await db.conversationMember.findMany({
    where: {conversationId, ...(conversation.kind === 'GROUP' ? {} : {admin: true})}, orderBy: [{admin: 'desc'}, {joinedAt: 'asc'}], take: limits.groupMembers,
    select: {admin: true, accepted: true, profile: {select: profileSelect}}});
  const members: ChatMember[] = memberRows.map(member => ({...toProfile(member.profile), admin: member.admin, accepted: member.accepted}));
  let remaining: number | null = null;
  if (row.peerId && row.summary.accepted) {
    const other = await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: row.peerId}}, select: {accepted: true}});
    if (!other?.accepted) remaining = requestRemaining(await db.message.count({where: {conversationId, senderProfileId: me.profileId}}), requestMessageLimit());
  }
  return {...row.summary, admin, members, readOnly: readOnly || (conversation.kind === 'DIRECT' && !row.summary.other), canModerate, blockedByMe: row.blocked,
    requestRemaining: remaining};
}
/** Ids of every conversation the profile belongs to; the stream subscribes to exactly these. */
export async function conversationIds(profileId: string) {
  return (await db.conversationMember.findMany({where: {profileId}, select: {conversationId: true}, take: 2000})).map(row => row.conversationId);
}
