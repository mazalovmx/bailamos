import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {notify} from '../notify';
import {rateLimit, type RateLimitOptions} from '../rate-limit';
import {mediaUrl} from '../account/media';
import {parseChatKey, variantKey} from '../media/keys';
import {managedSchoolIds} from '../schools/access';
import {storage} from '../storage';
import {attachmentUrls, deleteAttachmentObjects, deleteConversationAttachments} from './attachments';
import {directKey, directPeer, isBlockedBetween, isKnownTo, limits, requestMessageLimit, requestRemaining} from './policy';
import {claimNotification, conversationChannel, onlineProfiles, profileChannel, publish} from './realtime';
import type {ChatDetail, ChatInbox, ChatMember, ChatMessage, ChatPage, ChatProfile, ChatSummary, ChatUnread} from './types';
// The signed-in member as chat sees them. Built by chatActor()/chatViewer() in ./http.
// `schoolIds` are the schools the user manages on the site; in those schools' conversations they act as the school.
export type Me = {userId: string; profileId: string; role: string; name: string; schoolIds?: string[]};
type Tx = Prisma.TransactionClient;
const profileSelect = {id: true, handle: true, name: true, avatarKey: true} as const;
type ProfileRow = {id: string; handle: string; name: string; avatarKey: string | null};
const toProfile = (row: ProfileRow): ChatProfile => ({id: row.id, handle: row.handle, name: row.name, avatarUrl: row.avatarKey ? mediaUrl(row.avatarKey) : null});
type MessageRow = {id: string; conversationId: string; body: string; attachmentKey: string | null; editedAt: Date | null; deletedAt: Date | null;
  hiddenAt: Date | null; createdAt: Date; sender: ProfileRow};
// A hidden or deleted message never leaves the server: every reader, including the room admin, gets a placeholder.
// `blocked` holds the profiles the reader blocked; their messages are flagged so group and room threads collapse them.
const toMessage = (row: MessageRow, blocked?: Set<string>): ChatMessage => {
  const gone = !!row.hiddenAt || !!row.deletedAt;
  return {id: row.id, conversationId: row.conversationId, createdAt: row.createdAt.toISOString(), sender: toProfile(row.sender),
    body: gone ? null : row.body, attachment: !gone && row.attachmentKey ? attachmentUrls(row.id) : null,
    hidden: !!row.hiddenAt, deleted: !!row.deletedAt, editedAt: gone || !row.editedAt ? null : row.editedAt.toISOString(),
    blockedSender: !!blocked?.has(row.sender.id)};
};
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
// A message that carries an image may have no text at all.
const captionBody = z.string().max(8000).transform(clean).pipe(z.string().max(limits.bodyMax));
const attachmentInput = z.string().min(1).max(200);
export const messageInput = z.object({body: z.string().max(8000).default(''), attachmentKey: attachmentInput.optional()});
export const profileInput = z.object({profileId: z.string().min(1).max(40)});
const handle = z.string().trim().toLowerCase().transform(value => value.replace(/^@/, '')).pipe(z.string().min(1).max(40));
const title = z.string().transform(clean).pipe(z.string().min(1).max(limits.titleMax));
export const inviteInput = z.object({handle});
export const groupInput = z.object({title, handles: z.array(handle).max(20).default([])});
export const roomInput = z.union([z.object({eventId: z.string().min(1).max(40)}).strict(), z.object({cityId: z.string().min(1).max(40)}).strict()]);
export const removeInput = z.object({profileId: z.string().min(1).max(40).optional(), handle: handle.optional()});
export const renameInput = z.object({title});
const cursor = z.string().min(1).max(40).optional();
// `before` pages backwards, `after` returns what is newer, `from` re-reads forwards starting WITH the given message.
export const pageInput = z.object({before: cursor, after: cursor, from: cursor,
  limit: z.coerce.number().int().min(1).max(limits.pageMax).default(limits.pageSize)}).refine(value => [value.before, value.after, value.from].filter(Boolean).length < 2);
const isOpen = (event: {status: string; hiddenAt: Date | null}) => event.status === 'PUBLISHED' && !event.hiddenAt;
/** Organizers and members with a GOING or INTERESTED RSVP may use an event room; everybody else gets null. */
export async function eventRoomRole(eventId: string, profileId: string, client: Tx = db): Promise<'organizer' | 'attendee' | null> {
  const [organizer, rsvp, dateRsvp] = await Promise.all([
    client.eventMembership.findFirst({where: {eventId, profileId, role: {in: ['OWNER', 'CO_ORGANIZER']}}, select: {role: true}}),
    client.rsvp.findFirst({where: {eventId, profileId, status: {in: ['GOING', 'INTERESTED']}}, select: {status: true}}),
    // An answer for one upcoming date of a series opens the room as well.
    client.occurrenceRsvp.findFirst({where: {profileId, status: {in: ['GOING', 'INTERESTED']}, occurrence: {eventId, startsAt: {gte: new Date()}}}, select: {status: true}})]);
  return organizer ? 'organizer' : rsvp || dateRsvp ? 'attendee' : null;
}
const conversationInclude = {event: {select: {id: true, slug: true, title: true, status: true, hiddenAt: true}}, city: {select: {slug: true, name: true}},
  school: {select: {id: true, name: true}}} as const;
// A school's conversation is opened as the school by whoever manages that school. Direct conversations are never shared this way.
const managedBy = (me: Me, conversation: {kind: string; schoolProfileId: string | null}) =>
  conversation.kind !== 'DIRECT' && !!conversation.schoolProfileId && !!me.schoolIds?.includes(conversation.schoolProfileId);
/**
 * The single membership gate: every read and every write of a conversation goes through it. A conversation the caller is not
 * a member of is reported as NOT_FOUND, exactly like one that does not exist, so ids cannot be probed.
 * A manager of the school that owns the conversation passes as the school: `acting` is then the school's profile, and that
 * holds only for conversations whose schoolProfileId is one of the caller's own schools.
 */
export async function access(me: Me, conversationId: string, write = false) {
  const include = {conversation: {include: conversationInclude}};
  const school = me.schoolIds?.length ? await db.conversationMember.findFirst({include,
    where: {conversationId, profileId: {in: me.schoolIds}, conversation: {schoolProfileId: {in: me.schoolIds}, kind: {not: 'DIRECT'}}}}) : null;
  const asSchool = !!school && school.profileId === school.conversation.schoolProfileId;
  const member = asSchool ? school : await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: me.profileId}}, include});
  // A manager's personal membership in their school's conversation is not used: there they are the school or nobody.
  if (!member || (!asSchool && managedBy(me, member.conversation))) throw notFound();
  const conversation = member.conversation, acting = member.profileId;
  let admin = member.admin, readOnly = false;
  if (conversation.kind === 'EVENT') {
    const event = conversation.event, role = event && await eventRoomRole(event.id, acting);
    if (!event || !role) {
      // The RSVP was withdrawn or the organizer role removed: the room is closed for this member from now on.
      await db.conversationMember.deleteMany({where: {conversationId, profileId: acting}});
      throw notFound();
    }
    if (admin !== (role === 'organizer')) {
      admin = role === 'organizer';
      await db.conversationMember.updateMany({where: {conversationId, profileId: acting}, data: {admin}});
    }
    readOnly = !isOpen(event);
  }
  if (write) {
    if (!member.accepted) throw fail('REQUEST_NOT_ACCEPTED', 403);
    if (readOnly) throw fail('ROOM_READ_ONLY', 403);
  }
  const canModerate = conversation.kind !== 'DIRECT' && (admin || (['OWNER', 'ADMIN', 'MODERATOR'].includes(me.role) && (conversation.kind === 'EVENT' || conversation.kind === 'CITY')));
  return {member, conversation, admin, readOnly, canModerate, acting, asSchool};
}
// What a manager does in the name of a school is recorded with their own account, because the conversation shows only the school.
const schoolAudit = (me: Me, action: string, targetId: string, conversationId: string, schoolProfileId: string, extra: Prisma.InputJsonObject = {}) =>
  ({actorUserId: me.userId, action, targetType: 'Message', targetId, data: {conversationId, schoolProfileId, ...extra}});
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
// In a direct conversation: who the other side is and whether they still have to accept (a pending request).
async function directState(conversation: {id: string; kind: string; directKey: string | null}, acting: string) {
  if (conversation.kind !== 'DIRECT') return {peer: null, pending: false};
  const peer = conversation.directKey ? directPeer(conversation.directKey, acting) : null;
  if (!peer || await isBlockedBetween(acting, peer)) throw fail('CHAT_UNAVAILABLE', 403);
  const other = await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId: conversation.id, profileId: peer}}, select: {accepted: true}});
  return {peer, pending: !other?.accepted};
}
/**
 * The moment a new message is stamped with. Unread counters and paging compare timestamps, so it must be later than every
 * message, read mark and join already stored for the conversation. The wall clock alone does not guarantee that: two writes can
 * share a millisecond and the clock can step backwards (NTP, or the periodic resynchronisation of the JS clock on Windows).
 */
async function nextMoment(tx: Tx, conversationId: string) {
  const now = new Date();
  const [row] = await tx.$queryRaw<{at: Date | null}[]>`SELECT GREATEST(
    (SELECT max("createdAt") FROM "Message" WHERE "conversationId" = ${conversationId}),
    (SELECT GREATEST(max("lastReadAt"), max("joinedAt")) FROM "ConversationMember" WHERE "conversationId" = ${conversationId})) AS at`;
  return row?.at && row.at.getTime() >= now.getTime() ? new Date(row.at.getTime() + 1) : now;
}
/** Upload gate of the media pipeline (target "chat"): whoever may send here now may attach, except inside a pending request. */
export async function attachmentAccess(me: Me, conversationId: string) {
  const {conversation, acting} = await access(me, conversationId, true);
  if ((await directState(conversation, acting)).pending) throw fail('ATTACHMENT_NOT_ALLOWED', 403);
}
export async function sendMessage(me: Me, conversationId: string, rawBody: unknown, rawAttachment?: unknown) {
  const attachmentKey = rawAttachment === undefined || rawAttachment === null ? null : attachmentInput.parse(rawAttachment);
  const body = (attachmentKey ? captionBody : messageBody).parse(rawBody);
  const {conversation, acting, asSchool} = await access(me, conversationId, true);
  const {peer, pending} = await directState(conversation, acting);
  if (attachmentKey) {
    // Strangers cannot push images into somebody's requests.
    if (pending) throw fail('ATTACHMENT_NOT_ALLOWED', 403);
    // The key must come from an upload to this very conversation made by the caller, and its processed files must exist.
    const key = parseChatKey(attachmentKey);
    if (!key || key.conversationId !== conversationId || key.profileId !== me.profileId) throw fail('INVALID_INPUT', 400);
    await limit('chat:attach:' + me.userId, limits.attach);
    if (!await storage().exists(variantKey(attachmentKey, 800, 'webp'))) throw fail('INVALID_INPUT', 400);
  }
  await limit('chat:send:' + me.userId, limits.send);
  if (pending) await limit('chat:request:' + me.userId, limits.requestSend);
  let readded = false;
  const row = await db.$transaction(async tx => {
    // Serialised per sender and conversation, so parallel requests cannot slip past the request limit.
    if (pending && peer) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chat-request:' + conversationId + ':' + acting}))`;
    if (attachmentKey) {
      // One upload belongs to one message.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chat-attachment:' + attachmentKey}))`;
      if (await tx.message.findFirst({where: {attachmentKey}, select: {id: true}})) throw fail('INVALID_INPUT', 400);
    }
    const now = await nextMoment(tx, conversationId);
    if (pending && peer) {
      const other = await tx.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: peer}}, select: {accepted: true}});
      if (!other?.accepted) {
        // The count never resets: a declined request cannot be repeated beyond the same limit.
        const sent = await tx.message.count({where: {conversationId, senderProfileId: acting}});
        if (!requestRemaining(sent)) throw fail('REQUEST_LIMIT', 403);
        if (!other) {
          if (!await tx.profile.findFirst({where: {id: peer, userId: {not: null}}, select: {id: true}})) throw fail('CHAT_UNAVAILABLE', 403);
          await tx.conversationMember.create({data: {conversationId, profileId: peer, accepted: false, joinedAt: new Date(now.getTime() - 1)}});
          readded = true;
        }
      }
    }
    const created = await tx.message.create({data: {conversationId, senderProfileId: acting, body, attachmentKey, createdAt: now}, include: {sender: {select: profileSelect}}});
    await tx.conversation.update({where: {id: conversationId}, data: {updatedAt: now}});
    await tx.conversationMember.updateMany({where: {conversationId, profileId: acting}, data: {lastReadAt: now}});
    if (asSchool) await tx.auditLog.create({data: schoolAudit(me, 'SCHOOL_CHAT_MESSAGE', created.id, conversationId, acting)});
    return created;
  });
  const message = toMessage(row);
  await publish(conversationChannel(conversationId), {type: 'message', conversationId, message});
  if (peer && (readded || pending)) await publish(profileChannel(peer), {type: 'conversation', conversationId});
  await notifyMembers(conversationId, conversation.kind, message).catch(() => undefined);
  return message;
}
// One unread CHAT_MESSAGE notification per conversation and recipient, and none for members who are watching the stream.
async function notifyMembers(conversationId: string, kind: string, message: ChatMessage) {
  const sender = message.sender.id;
  const members = await db.conversationMember.findMany({where: {conversationId, profileId: {not: sender}, muted: false, profile: {userId: {not: null}},
    ...(kind === 'DIRECT' ? {} : {accepted: true})}, select: {profileId: true, lastReadAt: true, joinedAt: true, profile: {select: {userId: true}}}, take: 5000});
  if (!members.length) return;
  const profileIds = members.map(member => member.profileId);
  const [online, blockers] = await Promise.all([onlineProfiles(profileIds),
    db.block.findMany({where: {blockedProfileId: sender, blockerProfileId: {in: profileIds}}, select: {blockerProfileId: true}})]);
  const muted = new Set(blockers.map(block => block.blockerProfileId));
  let recipients = members.filter(member => !online.has(member.profileId) && !muted.has(member.profileId))
    .map(member => ({userId: member.profile.userId as string, epoch: (member.lastReadAt ?? member.joinedAt).getTime()}));
  if (!recipients.length) return;
  const unread = await db.notification.findMany({where: {userId: {in: recipients.map(row => row.userId)}, type: 'CHAT_MESSAGE', readAt: null,
    data: {path: ['conversationId'], equals: conversationId}}, select: {userId: true}});
  const has = new Set(unread.map(row => row.userId));
  recipients = recipients.filter(row => !has.has(row.userId));
  const claimed = await Promise.all(recipients.map(row => claimNotification(conversationId, row.userId, row.epoch)));
  await notify(recipients.filter((_, index) => claimed[index]).map(row => row.userId), 'CHAT_MESSAGE',
    {conversationId, messageId: message.id, senderName: message.sender.name, preview: (message.body ?? '').slice(0, 120)}, '/messages/' + conversationId);
}
export const blockedByMe = async (profileId: string) =>
  new Set((await db.block.findMany({where: {blockerProfileId: profileId}, select: {blockedProfileId: true}})).map(row => row.blockedProfileId));
export async function listMessages(me: Me, conversationId: string, input: z.input<typeof pageInput> = {}): Promise<ChatPage> {
  const {before, after, from, limit: size} = pageInput.parse(input);
  await access(me, conversationId);
  const cursorId = before ?? after ?? from;
  // The cursor must be a message of this very conversation; otherwise it could be used to probe foreign ids.
  if (cursorId && !await db.message.findFirst({where: {id: cursorId, conversationId}, select: {id: true}})) throw fail('INVALID_INPUT', 400);
  const forward = !!(after || from), direction = forward ? 'asc' as const : 'desc' as const;
  const [rows, blocked] = await Promise.all([db.message.findMany({where: {conversationId}, orderBy: [{createdAt: direction}, {id: direction}], take: size + 1,
    ...(cursorId ? {cursor: {id: cursorId}, skip: from ? 0 : 1} : {}), include: {sender: {select: profileSelect}}}), blockedByMe(me.profileId)]);
  const hasMore = rows.length > size, page = rows.slice(0, size);
  return {messages: (forward ? page : page.reverse()).map(row => toMessage(row, blocked)), hasMore};
}
// Mute is personal: it silences notifications for this member only. A school's shared conversation is muted per manager's own membership, so managers acting as the school cannot mute it.
export async function setMuted(me: Me, conversationId: string, muted: boolean) {
  await access(me, conversationId);
  const changed = await db.conversationMember.updateMany({where: {conversationId, profileId: me.profileId}, data: {muted}});
  if (!changed.count) throw notFound();
  return {muted};
}
export async function markRead(me: Me, conversationId: string) {
  const {acting} = await access(me, conversationId);
  // Never earlier than the newest message, whatever the clock says: reading always covers everything that is there.
  const newest = await db.message.findFirst({where: {conversationId}, orderBy: [{createdAt: 'desc'}], select: {createdAt: true}});
  const now = new Date(), at = newest && newest.createdAt > now ? newest.createdAt : now;
  await db.conversationMember.updateMany({where: {conversationId, profileId: acting}, data: {lastReadAt: at}});
  await db.notification.updateMany({where: {userId: me.userId, type: {in: ['CHAT_MESSAGE', 'GROUP_INVITE']}, readAt: null,
    data: {path: ['conversationId'], equals: conversationId}}, data: {readAt: now}});
}
export async function acceptConversation(me: Me, conversationId: string) {
  const {conversation, acting} = await access(me, conversationId);
  if (conversation.kind === 'DIRECT') {
    const peer = conversation.directKey ? directPeer(conversation.directKey, acting) : null;
    if (!peer || await isBlockedBetween(acting, peer)) throw fail('CHAT_UNAVAILABLE', 403);
  }
  await db.conversationMember.updateMany({where: {conversationId, profileId: acting}, data: {accepted: true}});
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
}
// Leaving a direct conversation declines it. The conversation row stays, so the request limit of the other side is not reset.
// `remove` names somebody else (by profile id or by handle); only the admins of a group, which includes the school in its own chats, may do that.
export async function leaveConversation(me: Me, conversationId: string, remove?: string | {profileId?: string; handle?: string}) {
  const {conversation, admin, acting, asSchool} = await access(me, conversationId);
  const wanted = typeof remove === 'string' ? {profileId: remove} : remove ?? {};
  let target = wanted.profileId && wanted.profileId !== acting ? wanted.profileId : acting;
  if (wanted.handle && !wanted.profileId) {
    if (conversation.kind !== 'GROUP' || !admin) throw fail('FORBIDDEN', 403);
    const profile = await db.profile.findUnique({where: {handle: wanted.handle}, select: {id: true}});
    if (!profile) throw notFound();
    target = profile.id;
  }
  if (target !== acting && (conversation.kind !== 'GROUP' || !admin)) throw fail('FORBIDDEN', 403);
  // The school stays in its own conversations: it cannot leave from the site and nobody removes it.
  if (conversation.schoolProfileId && target === conversation.schoolProfileId) throw fail('FORBIDDEN', 403);
  if (asSchool) await limit('chat:manage:' + me.userId, limits.manage);
  const removed = await db.conversationMember.deleteMany({where: {conversationId, profileId: target}});
  if (!removed.count) throw notFound();
  if (asSchool) await db.auditLog.create({data: {...schoolAudit(me, 'SCHOOL_CHAT_MEMBER_REMOVE', conversationId, conversationId, acting, {profileId: target}), targetType: 'Conversation'}});
  if (conversation.kind === 'GROUP') {
    const rest = await db.conversationMember.findMany({where: {conversationId}, orderBy: [{accepted: 'desc'}, {joinedAt: 'asc'}], select: {profileId: true, admin: true}});
    if (!rest.length) {
      const gone = await db.conversation.deleteMany({where: {id: conversationId, kind: 'GROUP'}});
      if (gone.count) await deleteConversationAttachments(conversationId).catch(() => undefined);
    } else if (!rest.some(member => member.admin))
      await db.conversationMember.updateMany({where: {conversationId, profileId: rest[0].profileId}, data: {admin: true, accepted: true}});
  }
  await publish(profileChannel(target), {type: 'conversation', conversationId});
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
}
// ---------- Blocks ----------
// The empty conversation id makes the blocker's own open streams re-read their block list; no thread reacts to it.
const blocksChanged = (me: Me) => publish(profileChannel(me.profileId), {type: 'conversation', conversationId: ''});
export async function blockProfile(me: Me, profileId: string) {
  if (profileId === me.profileId) throw fail('INVALID_INPUT', 400);
  if (!await db.profile.findUnique({where: {id: profileId}, select: {id: true}})) throw notFound();
  await db.block.createMany({data: [{blockerProfileId: me.profileId, blockedProfileId: profileId}], skipDuplicates: true});
  // A block also withdraws partner interest in both directions, as blocking from partner search does.
  await db.partnerInterest.deleteMany({where: {OR: [{fromProfileId: me.profileId, toProfileId: profileId}, {fromProfileId: profileId, toProfileId: me.profileId}]}});
  await blocksChanged(me);
  return {blocked: true};
}
export async function unblockProfile(me: Me, profileId: string) {
  await db.block.deleteMany({where: {blockerProfileId: me.profileId, blockedProfileId: profileId}});
  await blocksChanged(me);
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
type Inviter = {profileId: string; name: string};
async function invitee(inviter: Inviter, profileHandle: string) {
  const profile = await db.profile.findFirst({where: {handle: profileHandle, hiddenAt: null, userId: {not: null}, user: {bannedAt: null}}, select: {id: true, userId: true}});
  // Unknown handle, ownerless profile and a block in either direction look the same to the inviter.
  if (!profile || profile.id === inviter.profileId || await isBlockedBetween(inviter.profileId, profile.id)) throw fail('CANNOT_INVITE', 403);
  return profile;
}
// Invitations from strangers are requests too: the invited member has to accept before the group shows up among conversations.
// Either way the invitation is announced in the notification centre.
async function addMember(inviter: Inviter, group: {id: string; title: string | null}, profile: {id: string; userId: string | null}) {
  const accepted = await isKnownTo(inviter.profileId, profile.id), conversationId = group.id;
  const result = await db.conversationMember.createMany({data: [{conversationId, profileId: profile.id, accepted, joinedAt: new Date()}], skipDuplicates: true});
  if (!result.count) throw fail('ALREADY_MEMBER', 409);
  await publish(profileChannel(profile.id), {type: 'conversation', conversationId});
  if (profile.userId) await notify([profile.userId], 'GROUP_INVITE', {conversationId, title: group.title ?? '', inviterName: inviter.name}, '/messages/' + conversationId)
    .catch(() => undefined);
}
export async function createGroup(me: Me, raw: unknown) {
  const input = groupInput.parse(raw);
  await limit('chat:group:' + me.userId, limits.newGroup);
  const now = new Date();
  const group = await db.conversation.create({data: {kind: 'GROUP', title: input.title,
    members: {create: [{profileId: me.profileId, admin: true, accepted: true, joinedAt: now, lastReadAt: now}]}}, select: {id: true, title: true}});
  let invited = 0, skipped = 0;
  for (const profileHandle of [...new Set(input.handles)]) {
    try {await addMember(me, group, await invitee(me, profileHandle)); invited++;} catch (error) {
      if (!(error instanceof ApiError)) throw error;
      skipped++;
    }
  }
  return {id: group.id, invited, skipped};
}
export async function inviteMember(me: Me, conversationId: string, raw: unknown) {
  const {handle: profileHandle} = inviteInput.parse(raw);
  const {conversation, admin, acting, asSchool} = await access(me, conversationId, true);
  if (conversation.kind !== 'GROUP' || !admin) throw fail('FORBIDDEN', 403);
  await limit('chat:invite:' + me.userId, limits.invite);
  if (await db.conversationMember.count({where: {conversationId}}) >= limits.groupMembers) throw fail('GROUP_FULL', 409);
  // In a school's conversation the school invites, not the manager behind it.
  const inviter = asSchool && conversation.school ? {profileId: acting, name: conversation.school.name} : {profileId: acting, name: me.name};
  const profile = await invitee(inviter, profileHandle);
  await addMember(inviter, conversation, profile);
  if (asSchool) await db.auditLog.create({data: {...schoolAudit(me, 'SCHOOL_CHAT_MEMBER_ADD', conversationId, conversationId, acting, {profileId: profile.id}), targetType: 'Conversation'}});
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
  return {profileId: profile.id};
}
export async function renameConversation(me: Me, conversationId: string, raw: unknown) {
  const input = renameInput.parse(raw);
  const {conversation, admin, acting, asSchool} = await access(me, conversationId, true);
  if (conversation.kind !== 'GROUP' || !admin) throw fail('FORBIDDEN', 403);
  await limit('chat:manage:' + me.userId, limits.manage);
  // updatedAt orders the inbox by the latest message, so a rename leaves it alone.
  await db.conversation.update({where: {id: conversationId}, data: {title: input.title, updatedAt: conversation.updatedAt}});
  if (asSchool) await db.auditLog.create({data: {...schoolAudit(me, 'SCHOOL_CHAT_RENAME', conversationId, conversationId, acting, {title: input.title}), targetType: 'Conversation'}});
  await publish(conversationChannel(conversationId), {type: 'conversation', conversationId});
  return {id: conversationId, title: input.title};
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
// ---------- Editing and deleting one's own messages ----------
const ownMessage = {id: true, conversationId: true, senderProfileId: true, attachmentKey: true, hiddenAt: true, deletedAt: true, createdAt: true} as const;
/** The author corrects the text within the edit window. The image of a message cannot be replaced, only deleted with it. */
export async function editMessage(me: Me, messageId: string, rawBody: unknown) {
  const message = await db.message.findUnique({where: {id: messageId}, select: ownMessage});
  if (!message) throw notFound();
  const {conversation, acting, asSchool} = await access(me, message.conversationId, true);
  if (message.senderProfileId !== acting) throw fail('FORBIDDEN', 403);
  if (message.deletedAt || message.hiddenAt) throw fail('EDIT_UNAVAILABLE', 403);
  if (Date.now() - message.createdAt.getTime() > limits.editWindowMs) throw fail('EDIT_WINDOW_CLOSED', 403);
  // Rewriting old messages must not become a way around a block.
  await directState(conversation, acting);
  const body = (message.attachmentKey ? captionBody : messageBody).parse(rawBody);
  await limit('chat:edit:' + me.userId, limits.edit);
  const row = await db.$transaction(async tx => {
    if (asSchool) await tx.auditLog.create({data: schoolAudit(me, 'SCHOOL_CHAT_MESSAGE_EDIT', messageId, message.conversationId, acting)});
    return tx.message.update({where: {id: messageId}, data: {body, editedAt: new Date()}, include: {sender: {select: profileSelect}}});
  });
  const edited = toMessage(row);
  await publish(conversationChannel(message.conversationId), {type: 'edited', conversationId: message.conversationId, message: edited});
  return edited;
}
/** The author removes a message at any time: text and image are erased, the row stays as a placeholder in the thread. */
export async function deleteMessage(me: Me, messageId: string) {
  const message = await db.message.findUnique({where: {id: messageId}, select: ownMessage});
  if (!message) throw notFound();
  const conversationId = message.conversationId, {acting, asSchool} = await access(me, conversationId);
  if (message.senderProfileId !== acting) throw fail('FORBIDDEN', 403);
  if (message.deletedAt) return {id: messageId, deleted: true};
  await db.$transaction(async tx => {
    if (asSchool) await tx.auditLog.create({data: schoolAudit(me, 'SCHOOL_CHAT_MESSAGE_DELETE', messageId, conversationId, acting)});
    await tx.message.update({where: {id: messageId}, data: {deletedAt: new Date(), body: '', attachmentKey: null, editedAt: null}});
  });
  // The row no longer names the files; a failed removal leaves unreachable objects that go with the conversation.
  await deleteAttachmentObjects([message.attachmentKey]).catch(() => undefined);
  await erasePreviews(conversationId, messageId).catch(() => undefined);
  await publish(conversationChannel(conversationId), {type: 'deleted', conversationId, messageId});
  return {id: messageId, deleted: true};
}
// The notification written for a message quotes its first words; a deleted message takes that quote with it.
async function erasePreviews(conversationId: string, messageId: string) {
  const members = await db.conversationMember.findMany({where: {conversationId, profile: {userId: {not: null}}}, select: {profile: {select: {userId: true}}}, take: 5000});
  const rows = await db.notification.findMany({where: {userId: {in: members.map(member => member.profile.userId as string)}, type: 'CHAT_MESSAGE',
    data: {path: ['messageId'], equals: messageId}}, select: {id: true, data: true}});
  for (const row of rows) await db.notification.update({where: {id: row.id}, data: {data: {...(row.data as Prisma.JsonObject), preview: ''}}});
}
/** The storage key of a message's image, for a current member only; hidden and deleted messages have none to give. */
export async function attachmentKeyFor(me: Me, messageId: string) {
  const message = await db.message.findUnique({where: {id: messageId}, select: {conversationId: true, attachmentKey: true, hiddenAt: true, deletedAt: true}});
  if (!message) throw notFound();
  await access(me, message.conversationId);
  if (!message.attachmentKey || message.hiddenAt || message.deletedAt || !parseChatKey(message.attachmentKey)) throw notFound();
  return message.attachmentKey;
}
// ---------- Inbox, detail and unread counters ----------
const pair = (conversationId: string, profileId: string) => conversationId + ':' + profileId;
async function unreadMap(profileIds: string[]) {
  if (!profileIds.length) return new Map<string, number>();
  const rows = await db.$queryRaw<{conversationId: string; profileId: string; count: number}[]>`
    SELECT m."conversationId", m."profileId", count(x.id)::int AS count FROM "ConversationMember" m
    JOIN "Message" x ON x."conversationId" = m."conversationId" AND x."createdAt" > COALESCE(m."lastReadAt", m."joinedAt")
      AND x."senderProfileId" <> m."profileId" AND x."hiddenAt" IS NULL AND x."deletedAt" IS NULL
    WHERE m."profileId" IN (${Prisma.join(profileIds)}) GROUP BY m."conversationId", m."profileId"`;
  return new Map(rows.map(row => [pair(row.conversationId, row.profileId), Number(row.count)]));
}
// Summaries as seen by the member rows that match `where`: the caller's own row, or the row of a school they manage.
async function summaries(me: Me, where: Prisma.ConversationMemberWhereInput) {
  const rows = await db.conversationMember.findMany({where, orderBy: {conversation: {updatedAt: 'desc'}}, take: 200,
    include: {conversation: {include: {...conversationInclude, _count: {select: {members: true}},
      messages: {orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 1, include: {sender: {select: profileSelect}}}}}}});
  const peerIds = rows.flatMap(row => row.conversation.kind === 'DIRECT' && row.conversation.directKey ? [directPeer(row.conversation.directKey, row.profileId) ?? ''] : []);
  const [peers, unread, blocked] = await Promise.all([
    peerIds.length ? db.profile.findMany({where: {id: {in: peerIds}}, select: profileSelect}) : [],
    unreadMap([...new Set(rows.map(row => row.profileId))]), blockedByMe(me.profileId)]);
  const peerById = new Map(peers.map(peer => [peer.id, peer]));
  return rows.map(row => {
    const conversation = row.conversation, last = conversation.messages[0], gone = !!last && (!!last.hiddenAt || !!last.deletedAt);
    const peerId = conversation.kind === 'DIRECT' && conversation.directKey ? directPeer(conversation.directKey, row.profileId) : null;
    const peer = peerId ? peerById.get(peerId) : undefined;
    const managed = managedBy(me, conversation), asSchool = managed && row.profileId === conversation.schoolProfileId;
    // In a group or room the last words of somebody the reader blocked are not previewed.
    const blockedSender = !!last && conversation.kind !== 'DIRECT' && blocked.has(last.senderProfileId);
    const summary: ChatSummary = {id: conversation.id, kind: conversation.kind, title: conversation.title, other: peer ? toProfile(peer) : null,
      event: conversation.event && {slug: conversation.event.slug, title: conversation.event.title}, city: conversation.city,
      school: asSchool ? conversation.school : null,
      accepted: row.accepted, admin: row.admin, unread: unread.get(pair(conversation.id, row.profileId)) ?? 0, memberCount: conversation._count.members,
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessage: last ? {body: gone || blockedSender ? null : last.body.slice(0, 160), hidden: !!last.hiddenAt, deleted: !!last.deletedAt,
        attachment: !gone && !!last.attachmentKey, blockedSender, senderName: last.sender.name,
        mine: last.senderProfileId === row.profileId, createdAt: last.createdAt.toISOString()} : null};
    return {summary, peerId, blocked: !!peerId && blocked.has(peerId), event: conversation.event, managed, asSchool};
  });
}
export async function inbox(me: Me): Promise<ChatInbox> {
  const schoolIds = me.schoolIds ?? [];
  const [own, school] = await Promise.all([summaries(me, {profileId: me.profileId}),
    schoolIds.length ? summaries(me, {profileId: {in: schoolIds}, conversation: {schoolProfileId: {in: schoolIds}, kind: {not: 'DIRECT'}}}) : []]);
  // Direct conversations with somebody the viewer blocked, with a deleted profile or without any message stay out of the inbox.
  // Conversations of a school the viewer manages are listed once, in the school section.
  const visible = own.filter(row => !row.managed && (row.summary.kind !== 'DIRECT' || (row.summary.other && !row.blocked && row.summary.lastMessage)));
  return {conversations: visible.filter(row => row.summary.accepted).map(row => row.summary),
    requests: visible.filter(row => !row.summary.accepted).map(row => row.summary),
    school: school.filter(row => row.asSchool).map(row => row.summary)};
}
export async function unreadCounts(me: Me): Promise<ChatUnread> {
  const profileIds = [...new Set([me.profileId, ...(me.schoolIds ?? [])])];
  const [rows, unread, blocked] = await Promise.all([
    db.conversationMember.findMany({where: {profileId: {in: profileIds}}, select: {conversationId: true, profileId: true, accepted: true,
      conversation: {select: {kind: true, directKey: true, schoolProfileId: true}}}}),
    unreadMap(profileIds), blockedByMe(me.profileId)]);
  const result = {total: 0, conversations: 0, requests: 0};
  for (const row of rows) {
    // A school's row counts only in that school's own conversations; the manager's personal row never counts there.
    if (managedBy(me, row.conversation) ? row.profileId !== row.conversation.schoolProfileId : row.profileId !== me.profileId) continue;
    const peer = row.conversation.kind === 'DIRECT' && row.conversation.directKey ? directPeer(row.conversation.directKey, me.profileId) : null;
    if (peer && blocked.has(peer)) continue;
    const count = unread.get(pair(row.conversationId, row.profileId)) ?? 0;
    if (!row.accepted) {if (count || row.conversation.kind !== 'DIRECT') result.requests++;}
    else if (count) {result.total += count; result.conversations++;}
  }
  return result;
}
export async function conversationDetail(me: Me, conversationId: string): Promise<ChatDetail> {
  const {conversation, admin, readOnly, canModerate, acting} = await access(me, conversationId);
  const [row] = await summaries(me, {conversationId, profileId: acting});
  if (!row) throw notFound();
  // Room member lists stay private (an event may hide its attendees); only the admins of a room are shown.
  const memberRows = conversation.kind === 'DIRECT' ? [] : await db.conversationMember.findMany({
    where: {conversationId, ...(conversation.kind === 'GROUP' ? {} : {admin: true})}, orderBy: [{admin: 'desc'}, {joinedAt: 'asc'}], take: limits.groupMembers,
    select: {admin: true, accepted: true, profile: {select: profileSelect}}});
  const members: ChatMember[] = memberRows.map(member => ({...toProfile(member.profile), admin: member.admin, accepted: member.accepted}));
  let remaining: number | null = null;
  if (row.peerId && row.summary.accepted) {
    const other = await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: row.peerId}}, select: {accepted: true}});
    if (!other?.accepted) remaining = requestRemaining(await db.message.count({where: {conversationId, senderProfileId: acting}}), requestMessageLimit());
  }
  const closed = readOnly || (conversation.kind === 'DIRECT' && !row.summary.other);
  const mine = await db.conversationMember.findUnique({where: {conversationId_profileId: {conversationId, profileId: me.profileId}}, select: {muted: true}});
  return {...row.summary, admin, members, readOnly: closed, canModerate, blockedByMe: row.blocked, requestRemaining: remaining, actingProfileId: acting,
    muted: mine ? mine.muted : null,
    canAttach: row.summary.accepted && !closed && !row.blocked && remaining === null};
}
/** Ids of every conversation the member may follow live: their own and those of the schools they manage (read afresh, so a revoked grant stops at once). */
export async function conversationIds(me: Pick<Me, 'userId' | 'profileId'>) {
  const schoolIds = await managedSchoolIds(me.userId);
  const [own, school] = await Promise.all([
    db.conversationMember.findMany({where: {profileId: me.profileId}, select: {conversationId: true, conversation: {select: {kind: true, schoolProfileId: true}}}, take: 2000}),
    schoolIds.length ? db.conversation.findMany({where: {schoolProfileId: {in: schoolIds}, kind: {not: 'DIRECT'}}, select: {id: true}, take: 2000}) : []]);
  const personal = own.filter(row => !managedBy({...me, role: '', name: '', schoolIds}, row.conversation)).map(row => row.conversationId);
  return [...new Set([...personal, ...school.map(row => row.id)])];
}
