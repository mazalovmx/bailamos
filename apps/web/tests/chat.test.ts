// Chat in the monolith: request policy, blocks, membership gate, rooms, limits, unread counters, pagination, realtime and the HTTP layer.
// Database tests create their own users, profiles, events and conversations and remove them afterwards.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import {linkify, safeHref, LINK_REL} from '../src/lib/chat/linkify';
import {directKey, directPeer, requestRemaining} from '../src/lib/chat/policy';
const tag = randomUUID().slice(0, 8);
type Me = {userId: string; profileId: string; role: string; name: string};
const userIds: string[] = [], eventIds: string[] = [], profileIds: string[] = [];
const code = (expected: string) => (error: unknown) => (error as {code?: string}).code === expected;
async function available(t: {skip(message: string): void}) {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`; return db;} catch {t.skip('PostgreSQL is not available'); return null;}
}
async function member(label: string, role: 'USER' | 'MODERATOR' = 'USER'): Promise<Me> {
  const {db} = await import('@dance/db');
  const id = 'chat-' + tag + '-' + label + '-' + randomUUID().slice(0, 6);
  await db.user.create({data: {id, name: label, email: id + '@example.test', emailVerified: true, ageConfirmed: true, role}});
  const profile = await db.profile.create({data: {userId: id, type: 'DANCER', handle: id, name: 'Name ' + label, lat: 40.4, lng: -3.7}});
  userIds.push(id); profileIds.push(profile.id);
  return {userId: id, profileId: profile.id, role, name: profile.name};
}
async function event(owner: Me, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') {
  const {db} = await import('@dance/db');
  const city = await db.city.findFirstOrThrow();
  const row = await db.event.create({data: {slug: 'chat-' + tag + '-' + randomUUID().slice(0, 6), title: 'Chat test social', startsAt: new Date(Date.now() + 86400_000),
    timezone: city.timezone, cityId: city.id, status, members: {create: {profileId: owner.profileId, role: 'OWNER'}}}});
  eventIds.push(row.id);
  return row;
}
after(async () => {
  const {db} = await import('@dance/db');
  try {
    await db.event.deleteMany({where: {id: {in: eventIds}}});
    // Direct conversations are not tied to a profile by a foreign key, groups lose their members by cascade: both are removed by hand.
    await db.conversation.deleteMany({where: {OR: [...profileIds.map(id => ({directKey: {contains: id}})), {members: {some: {profileId: {in: profileIds}}}, kind: 'GROUP' as const}]}});
    await db.conversationMember.deleteMany({where: {profileId: {in: profileIds}}});
    await db.auditLog.deleteMany({where: {actorUserId: {in: userIds}}});
    await db.user.deleteMany({where: {id: {in: userIds}}});
  } catch {/* the database was not available */}
  const {closeChatRealtime} = await import('../src/lib/chat/realtime');
  const {closeRedis} = await import('../src/lib/redis');
  await closeChatRealtime(); await closeRedis(); await db.$disconnect();
});
test('linkifier: only http(s) URLs become links and nothing can inject markup or script URLs', () => {
  const parts = linkify('See https://swing.example/party?x=1&y=<b>. Also (http://a.example/b), done');
  assert.deepEqual(parts.filter(part => part.type === 'link').map(part => part.type === 'link' && part.href), ['https://swing.example/party?x=1&y=', 'http://a.example/b']);
  assert.equal(parts.map(part => part.value).join(''), 'See https://swing.example/party?x=1&y=<b>. Also (http://a.example/b), done', 'no character is lost');
  for (const text of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">x</a>', '<img src=x onerror=alert(1)>', 'file:///etc/passwd', 'www.example.com', 'xhttp://evil.example', 'https://bank.example@evil.example/login',
    'https://user:pass@evil.example', 'http://localhost/admin', 'https://']) {
    const result = linkify(text);
    assert.equal(result.some(part => part.type === 'link'), false, text);
    assert.equal(result.map(part => part.value).join(''), text);
  }
  for (const part of linkify('x https://ok.example/"onmouseover="alert(1) y')) if (part.type === 'link') {
    assert.equal(part.href, 'https://ok.example/');
    assert.equal(/["'<>\s]/.test(part.href), false);
  }
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://ok.example/a b'), 'https://ok.example/a%20b');
  assert.equal(LINK_REL, 'nofollow ugc noopener');
  // The renderer builds React nodes from the parts and never injects HTML.
  const shared = readFileSync(new URL('../src/components/chat/shared.tsx', import.meta.url), 'utf8');
  assert.ok(shared.includes('rel={LINK_REL}') && !shared.includes('dangerouslySetInnerHTML'));
  for (const file of ['thread.tsx', 'inbox.tsx']) assert.equal(readFileSync(new URL('../src/components/chat/' + file, import.meta.url), 'utf8').includes('dangerouslySetInnerHTML'), false);
});
test('policy helpers: direct key is order independent and the request allowance never goes negative', () => {
  assert.equal(directKey('b', 'a'), 'a:b');
  assert.equal(directKey('a', 'b'), directKey('b', 'a'));
  assert.equal(directPeer('a:b', 'a'), 'b');
  assert.equal(directPeer('a:b', 'b'), 'a');
  assert.deepEqual([0, 1, 2, 3, 9].map(sent => requestRemaining(sent, 3)), [3, 2, 1, 0, 0]);
});
test('not a stranger: follow by the recipient, mutual partner interest or a shared accepted conversation', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const {isKnownTo} = await import('../src/lib/chat/policy');
  const [a, b] = [await member('ka'), await member('kb')];
  assert.equal(await isKnownTo(a.profileId, b.profileId), false);
  // The SENDER following the recipient proves nothing; the recipient following the sender does.
  const own = await db.follow.create({data: {userId: a.userId, profileId: b.profileId}});
  assert.equal(await isKnownTo(a.profileId, b.profileId), false);
  assert.equal(await isKnownTo(b.profileId, a.profileId), true);
  await db.follow.delete({where: {id: own.id}});
  await db.partnerInterest.create({data: {fromProfileId: a.profileId, toProfileId: b.profileId}});
  assert.equal(await isKnownTo(a.profileId, b.profileId), false, 'one-directional interest is not a match');
  await db.partnerInterest.create({data: {fromProfileId: b.profileId, toProfileId: a.profileId}});
  assert.equal(await isKnownTo(a.profileId, b.profileId), true);
  await db.partnerInterest.deleteMany({where: {fromProfileId: {in: [a.profileId, b.profileId]}}});
  const group = await db.conversation.create({data: {kind: 'GROUP', title: 'policy', members: {create: [{profileId: a.profileId}, {profileId: b.profileId, accepted: false}]}}});
  assert.equal(await isKnownTo(a.profileId, b.profileId), false, 'a pending invitation is not a shared conversation');
  await db.conversationMember.updateMany({where: {conversationId: group.id}, data: {accepted: true}});
  assert.equal(await isKnownTo(a.profileId, b.profileId), true);
  await db.conversation.update({where: {id: group.id}, data: {kind: 'CITY'}});
  assert.equal(await isKnownTo(a.profileId, b.profileId), false, 'public rooms do not make people acquainted');
  await db.conversation.delete({where: {id: group.id}});
});
test('a stranger gets a request with a message limit; accepting lifts it; declining never resets it', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b] = [await member('ra'), await member('rb')];
  await assert.rejects(chat.openDirect(a, a.profileId), code('CHAT_SELF'));
  await assert.rejects(chat.openDirect(a, 'missing-' + tag), code('CHAT_UNAVAILABLE'));
  const opened = await chat.openDirect(a, b.profileId);
  assert.equal(opened.created, true);
  assert.deepEqual(await chat.openDirect(b, a.profileId), {id: opened.id, created: false}, 'one conversation per pair, whoever opens it');
  assert.equal((await chat.inbox(b)).requests.length, 0, 'an empty request is not shown');
  assert.equal((await chat.conversationDetail(a, opened.id)).requestRemaining, 3);
  for (const text of ['one', 'two', 'three']) await chat.sendMessage(a, opened.id, text);
  await assert.rejects(chat.sendMessage(a, opened.id, 'four'), code('REQUEST_LIMIT'));
  assert.equal((await chat.conversationDetail(a, opened.id)).requestRemaining, 0);
  const box = await chat.inbox(b);
  assert.deepEqual([box.requests.map(row => row.id), box.conversations.length], [[opened.id], 0]);
  assert.equal(box.requests[0].unread, 3);
  assert.deepEqual(await chat.unreadCounts(b), {total: 0, conversations: 0, requests: 1});
  // The recipient reads the request but cannot answer before accepting.
  assert.equal((await chat.listMessages(b, opened.id)).messages.length, 3);
  await assert.rejects(chat.sendMessage(b, opened.id, 'hi'), code('REQUEST_NOT_ACCEPTED'));
  await chat.acceptConversation(b, opened.id);
  assert.equal((await chat.inbox(b)).conversations[0].id, opened.id);
  assert.equal((await chat.conversationDetail(a, opened.id)).requestRemaining, null);
  await chat.sendMessage(a, opened.id, 'four');
  await chat.sendMessage(b, opened.id, 'reply');
  assert.equal(await db.message.count({where: {conversationId: opened.id}}), 5);
  // Declined request: the sender has two messages left in total, and leaving and reopening does not give more.
  const c = await member('rc');
  const second = await chat.openDirect(a, c.profileId);
  await chat.sendMessage(a, second.id, 'hello');
  await chat.leaveConversation(c, second.id);
  assert.equal((await chat.inbox(c)).requests.length, 0);
  await assert.rejects(chat.listMessages(c, second.id), code('NOT_FOUND'));
  await chat.sendMessage(a, second.id, 'again');
  assert.equal((await chat.inbox(c)).requests[0]?.unread, 1, 'the repeated request shows only what came after the decline');
  await chat.leaveConversation(a, second.id);
  assert.equal((await chat.openDirect(a, c.profileId)).id, second.id);
  await chat.sendMessage(a, second.id, 'third');
  await assert.rejects(chat.sendMessage(a, second.id, 'fourth'), code('REQUEST_LIMIT'));
  // Somebody the recipient follows is not a stranger: no request, no limit.
  const d = await member('rd');
  await db.follow.create({data: {userId: d.userId, profileId: a.profileId}});
  const known = await chat.openDirect(a, d.profileId);
  for (let index = 0; index < 5; index++) await chat.sendMessage(a, known.id, 'known ' + index);
  assert.equal((await chat.inbox(d)).conversations[0]?.unread, 5);
  // Message text: trimmed, control characters removed, 1 to 2000 characters.
  assert.equal((await chat.sendMessage(a, known.id, '  hi\u0000‮ there \r\n\r\n\r\n\r\nx  ')).body, 'hi there \n\nx');
  for (const bad of ['', '   ', '\u0000', 'x'.repeat(2001), 5, null, {}]) await assert.rejects(chat.sendMessage(a, known.id, bad), {name: 'ZodError'});
  assert.equal((await chat.sendMessage(a, known.id, 'x'.repeat(2000))).body?.length, 2000);
});
test('a block in either direction stops new conversations and sending, with one generic error', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const {isBlockedBetween} = await import('../src/lib/chat/policy');
  const [a, b, c] = [await member('ba'), await member('bb'), await member('bc')];
  const direct = await chat.openDirect(a, b.profileId);
  await chat.sendMessage(a, direct.id, 'request');
  assert.equal((await chat.inbox(b)).requests.length, 1);
  await chat.blockProfile(b, a.profileId);
  await chat.blockProfile(b, a.profileId);
  assert.equal(await db.block.count({where: {blockerProfileId: b.profileId}}), 1, 'blocking twice is harmless');
  assert.equal(await isBlockedBetween(a.profileId, b.profileId), true);
  assert.equal(await isBlockedBetween(b.profileId, a.profileId), true);
  assert.equal(await isBlockedBetween(a.profileId, c.profileId), false);
  const box = await chat.inbox(b);
  assert.deepEqual([box.requests.length, box.conversations.length], [0, 0], 'the blocked request disappears');
  assert.deepEqual(await chat.unreadCounts(b), {total: 0, conversations: 0, requests: 0});
  assert.deepEqual((await chat.listBlocks(b)).map(profile => profile.id), [a.profileId]);
  // The blocked side and the blocking side get the same answer.
  await assert.rejects(chat.sendMessage(a, direct.id, 'more'), code('CHAT_UNAVAILABLE'));
  await assert.rejects(chat.acceptConversation(b, direct.id), code('CHAT_UNAVAILABLE'));
  await assert.rejects(chat.openDirect(a, b.profileId), code('CHAT_UNAVAILABLE'));
  await assert.rejects(chat.openDirect(b, a.profileId), code('CHAT_UNAVAILABLE'));
  // No conversation yet, block in the other direction.
  await chat.blockProfile(a, c.profileId);
  await assert.rejects(chat.openDirect(c, a.profileId), code('CHAT_UNAVAILABLE'));
  await assert.rejects(chat.openDirect(a, c.profileId), code('CHAT_UNAVAILABLE'));
  assert.equal(await db.conversation.count({where: {directKey: directKey(a.profileId, c.profileId)}}), 0);
  // Group invitations respect blocks without saying so.
  const group = await chat.createGroup(a, {title: 'Block test', handles: [b.userId, c.userId, 'nobody-' + tag]});
  assert.deepEqual([group.invited, group.skipped], [0, 3]);
  await assert.rejects(chat.inviteMember(a, group.id, {handle: b.userId}), code('CANNOT_INVITE'));
  await assert.rejects(chat.inviteMember(a, group.id, {handle: 'nobody-' + tag}), code('CANNOT_INVITE'));
  await assert.rejects(chat.blockProfile(a, a.profileId), code('INVALID_INPUT'));
  await chat.unblockProfile(b, a.profileId);
  assert.equal(await isBlockedBetween(a.profileId, b.profileId), false);
  await chat.sendMessage(a, direct.id, 'after unblock');
  assert.equal((await chat.inbox(b)).requests.length, 1);
});
test('membership is enforced on every read and write', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b, outsider] = [await member('ma'), await member('mb'), await member('mo')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const direct = await chat.openDirect(a, b.profileId);
  const message = await chat.sendMessage(a, direct.id, 'private');
  const foreign = await chat.createGroup(outsider, {title: 'Other', handles: []});
  const theirs = await chat.sendMessage(outsider, foreign.id, 'elsewhere');
  for (const attempt of [() => chat.listMessages(outsider, direct.id), () => chat.sendMessage(outsider, direct.id, 'let me in'), () => chat.conversationDetail(outsider, direct.id),
    () => chat.markRead(outsider, direct.id), () => chat.acceptConversation(outsider, direct.id), () => chat.leaveConversation(outsider, direct.id),
    () => chat.setMessageHidden(outsider, message.id, true), () => chat.inviteMember(outsider, direct.id, {handle: outsider.userId}),
    () => chat.leaveConversation(outsider, direct.id, a.profileId), () => chat.listMessages(a, 'missing-' + tag)]) await assert.rejects(attempt(), code('NOT_FOUND'));
  assert.equal(await db.message.count({where: {conversationId: direct.id}}), 1);
  assert.equal((await db.message.findUniqueOrThrow({where: {id: message.id}})).hiddenAt, null);
  // A cursor from another conversation is rejected instead of being used as a probe.
  await assert.rejects(chat.listMessages(a, direct.id, {before: theirs.id}), code('INVALID_INPUT'));
  await assert.rejects(chat.listMessages(a, direct.id, {after: theirs.id}), code('INVALID_INPUT'));
  // Nobody can hide messages in a direct conversation, and a member cannot remove the other one.
  await assert.rejects(chat.setMessageHidden(b, message.id, true), code('FORBIDDEN'));
  await assert.rejects(chat.leaveConversation(b, direct.id, a.profileId), code('FORBIDDEN'));
  assert.equal((await chat.inbox(outsider)).conversations.some(row => row.id === direct.id), false);
  // What a reader gets about other people: public profile fields only.
  const text = JSON.stringify([await chat.conversationDetail(b, direct.id), await chat.listMessages(b, direct.id), await chat.inbox(b)]);
  assert.equal(/example\.test|"email"|"lat"|"lng"|40\.4|-3\.7|"userId"/.test(text), false);
});
test('event room: organizers and GOING/INTERESTED only, organizer moderates, read-only when unpublished, gone with the event', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [owner, going, interested, declined, nobody] = [await member('eo'), await member('eg'), await member('ei'), await member('ed'), await member('en')];
  const party = await event(owner), draft = await event(owner, 'DRAFT');
  await db.rsvp.createMany({data: [{eventId: party.id, profileId: going.profileId, status: 'GOING'}, {eventId: party.id, profileId: interested.profileId, status: 'INTERESTED'},
    {eventId: party.id, profileId: declined.profileId, status: 'DECLINED'}]});
  await assert.rejects(chat.joinRoom(owner, {eventId: draft.id}), code('NOT_FOUND'));
  await assert.rejects(chat.joinRoom(nobody, {eventId: party.id}), code('ROOM_NOT_ELIGIBLE'));
  await assert.rejects(chat.joinRoom(declined, {eventId: party.id}), code('ROOM_NOT_ELIGIBLE'));
  assert.equal(await db.conversation.count({where: {eventId: party.id}}), 0, 'refused members do not create the room');
  const [first, second, third] = await Promise.all([chat.joinRoom(owner, {eventId: party.id}), chat.joinRoom(going, {eventId: party.id}), chat.joinRoom(interested, {eventId: party.id})]);
  assert.ok(first.id === second.id && second.id === third.id, 'concurrent first joins end in one room');
  assert.equal((await chat.joinRoom(going, {eventId: party.id})).id, first.id);
  const room = first.id;
  const detail = await chat.conversationDetail(going, room);
  assert.deepEqual([detail.kind, detail.memberCount, detail.canModerate, detail.readOnly], ['EVENT', 3, false, false]);
  assert.deepEqual(detail.members.map(row => row.id), [owner.profileId], 'only room admins are listed, attendees stay private');
  assert.equal((await chat.conversationDetail(owner, room)).canModerate, true);
  const rude = await chat.sendMessage(going, room, 'rude');
  await assert.rejects(chat.setMessageHidden(interested, rude.id, true), code('FORBIDDEN'));
  await chat.setMessageHidden(owner, rude.id, true);
  const page = await chat.listMessages(interested, room);
  assert.deepEqual([page.messages[0].hidden, page.messages[0].body], [true, null], 'the text of a hidden message is not sent to anyone');
  assert.equal((await chat.inbox(interested)).conversations[0].lastMessage?.body, null);
  assert.equal(await db.auditLog.count({where: {actorUserId: owner.userId, action: 'CHAT_MESSAGE_HIDE', targetId: rude.id}}), 1);
  await chat.setMessageHidden(owner, rude.id, false);
  assert.equal((await chat.listMessages(interested, room)).messages[0].body, 'rude');
  // Withdrawing the RSVP closes the room for that member on the next read or write.
  await db.rsvp.update({where: {eventId_profileId: {eventId: party.id, profileId: interested.profileId}}, data: {status: 'DECLINED'}});
  await assert.rejects(chat.sendMessage(interested, room, 'still here?'), code('NOT_FOUND'));
  await assert.rejects(chat.listMessages(interested, room), code('NOT_FOUND'));
  // Cancelled or hidden event: the room stays readable but nobody can write or join.
  await db.event.update({where: {id: party.id}, data: {status: 'CANCELLED'}});
  await assert.rejects(chat.sendMessage(going, room, 'see you'), code('ROOM_READ_ONLY'));
  await assert.rejects(chat.sendMessage(owner, room, 'sorry'), code('ROOM_READ_ONLY'));
  assert.equal((await chat.conversationDetail(going, room)).readOnly, true);
  assert.equal((await chat.listMessages(going, room)).messages.length, 1);
  await assert.rejects(chat.joinRoom(nobody, {eventId: party.id}), code('NOT_FOUND'));
  await db.event.update({where: {id: party.id}, data: {status: 'PUBLISHED', hiddenAt: new Date()}});
  await assert.rejects(chat.sendMessage(going, room, 'see you'), code('ROOM_READ_ONLY'));
  await db.event.delete({where: {id: party.id}});
  assert.equal(await db.conversation.count({where: {id: room}}), 0);
  assert.equal(await db.message.count({where: {conversationId: room}}), 0);
  await assert.rejects(chat.listMessages(going, room), code('NOT_FOUND'));
});
test('city room and groups: join, invite by handle, requests from strangers, removal and leaving', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b, c, staff] = [await member('ga'), await member('gb'), await member('gc'), await member('gs', 'MODERATOR')];
  const city = await db.city.findFirstOrThrow();
  const before = await db.conversation.findUnique({where: {cityId: city.id}, select: {id: true}});
  const room = await chat.joinRoom(a, {cityId: city.id});
  assert.equal((await chat.joinRoom(b, {cityId: city.id})).id, room.id);
  await chat.joinRoom(staff, {cityId: city.id});
  await assert.rejects(chat.joinRoom(a, {cityId: 'missing-' + tag}), code('NOT_FOUND'));
  const spam = await chat.sendMessage(a, room.id, 'city hello');
  assert.equal((await chat.listMessages(b, room.id, {limit: 1})).messages[0].body, 'city hello');
  await assert.rejects(chat.setMessageHidden(b, spam.id, true), code('FORBIDDEN'));
  await chat.setMessageHidden(staff, spam.id, true);
  await chat.leaveConversation(b, room.id);
  await assert.rejects(chat.listMessages(b, room.id), code('NOT_FOUND'));
  await db.message.deleteMany({where: {id: spam.id}});
  for (const who of [a, staff]) await chat.leaveConversation(who, room.id);
  if (!before) await db.conversation.deleteMany({where: {id: room.id, members: {none: {}}}});
  // Group: b follows a (known), c does not (the invitation is a request).
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const group = await chat.createGroup(a, {title: '  Practice crew  ', handles: ['@' + b.userId.toUpperCase(), c.userId, c.userId]});
  assert.deepEqual([group.invited, group.skipped], [2, 0]);
  const detail = await chat.conversationDetail(a, group.id);
  assert.deepEqual([detail.title, detail.kind, detail.admin, detail.memberCount], ['Practice crew', 'GROUP', true, 3]);
  assert.deepEqual(detail.members.map(row => [row.id, row.admin, row.accepted]), [[a.profileId, true, true], [b.profileId, false, true], [c.profileId, false, false]]);
  assert.equal((await chat.inbox(b)).conversations[0].id, group.id);
  assert.deepEqual((await chat.inbox(c)).requests.map(row => row.id), [group.id]);
  assert.equal((await chat.unreadCounts(c)).requests, 1);
  await assert.rejects(chat.sendMessage(c, group.id, 'hi'), code('REQUEST_NOT_ACCEPTED'));
  await chat.acceptConversation(c, group.id);
  await chat.sendMessage(c, group.id, 'hi all');
  await assert.rejects(chat.inviteMember(a, group.id, {handle: c.userId}), code('ALREADY_MEMBER'));
  await assert.rejects(chat.inviteMember(b, group.id, {handle: staff.userId}), code('FORBIDDEN'));
  await assert.rejects(chat.leaveConversation(b, group.id, c.profileId), code('FORBIDDEN'));
  await assert.rejects(chat.createGroup(a, {title: ' ', handles: []}), {name: 'ZodError'});
  await chat.leaveConversation(a, group.id, c.profileId);
  await assert.rejects(chat.listMessages(c, group.id), code('NOT_FOUND'));
  // The last admin leaving hands the group over; the last member leaving removes it.
  await chat.leaveConversation(a, group.id);
  assert.equal((await chat.conversationDetail(b, group.id)).admin, true);
  await chat.leaveConversation(b, group.id);
  assert.equal(await db.conversation.count({where: {id: group.id}}), 0);
});
test('sending is rate limited per user', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const {limits} = await import('../src/lib/chat/policy');
  const a = await member('la');
  const group = await chat.createGroup(a, {title: 'Limit', handles: []});
  for (let index = 0; index < limits.send.limit; index++) await chat.sendMessage(a, group.id, 'message ' + index);
  await assert.rejects(chat.sendMessage(a, group.id, 'one too many'), (error: {code?: string; status?: number}) => error.code === 'RATE_LIMITED' && error.status === 429);
  assert.equal(await db.message.count({where: {conversationId: group.id}}), limits.send.limit);
  // Messages to people who have not accepted share a much smaller hourly budget across all requests.
  assert.ok(limits.requestSend.limit / limits.requestSend.windowSec < limits.send.limit / limits.send.windowSec);
});
test('unread counters, read marks, backwards pagination and coalesced notifications', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b] = [await member('ua'), await member('ub')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  await db.follow.create({data: {userId: a.userId, profileId: b.profileId}});
  const direct = await chat.openDirect(a, b.profileId);
  const sent: string[] = [];
  for (let index = 1; index <= 7; index++) sent.push((await chat.sendMessage(a, direct.id, 'm' + index)).id);
  assert.deepEqual(await chat.unreadCounts(b), {total: 7, conversations: 1, requests: 0});
  assert.deepEqual(await chat.unreadCounts(a), {total: 0, conversations: 0, requests: 0}, 'own messages are never unread');
  // A burst creates exactly one unread notification, addressed to the recipient only.
  const notes = await db.notification.findMany({where: {userId: {in: [a.userId, b.userId]}, type: 'CHAT_MESSAGE'}});
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].userId, notes[0].url, notes[0].data], [b.userId, '/messages/' + direct.id, {conversationId: direct.id, senderName: a.name, preview: 'm1'}]);
  // Pages of three, newest first, each page in chronological order.
  const newest = await chat.listMessages(b, direct.id, {limit: 3});
  assert.deepEqual([newest.messages.map(row => row.body), newest.hasMore], [['m5', 'm6', 'm7'], true]);
  const middle = await chat.listMessages(b, direct.id, {limit: 3, before: newest.messages[0].id});
  assert.deepEqual([middle.messages.map(row => row.body), middle.hasMore], [['m2', 'm3', 'm4'], true]);
  const oldest = await chat.listMessages(b, direct.id, {limit: 3, before: middle.messages[0].id});
  assert.deepEqual([oldest.messages.map(row => row.body), oldest.hasMore], [['m1'], false]);
  // Polling fallback: everything after a known message.
  const since = await chat.listMessages(b, direct.id, {after: sent[4]});
  assert.deepEqual([since.messages.map(row => row.body), since.hasMore], [['m6', 'm7'], false]);
  assert.deepEqual((await chat.listMessages(b, direct.id, {after: sent[6]})).messages, []);
  await assert.rejects(chat.listMessages(b, direct.id, {before: sent[1], after: sent[2]}), {name: 'ZodError'});
  await assert.rejects(chat.listMessages(b, direct.id, {limit: 1000}), {name: 'ZodError'});
  assert.equal((await chat.listMessages(b, direct.id)).messages.length, 7, 'reading a page does not mark anything read');
  assert.equal((await chat.unreadCounts(b)).total, 7);
  await chat.markRead(b, direct.id);
  assert.deepEqual(await chat.unreadCounts(b), {total: 0, conversations: 0, requests: 0});
  assert.equal(await db.notification.count({where: {userId: b.userId, type: 'CHAT_MESSAGE', readAt: null}}), 0, 'reading the conversation reads its notification');
  await new Promise(resolve => setTimeout(resolve, 5));
  const late = await chat.sendMessage(a, direct.id, 'm8');
  await chat.sendMessage(a, direct.id, 'm9');
  assert.equal((await chat.inbox(b)).conversations[0].unread, 2);
  assert.equal(await db.notification.count({where: {userId: b.userId, type: 'CHAT_MESSAGE', readAt: null}}), 1, 'a new burst after reading notifies once again');
  // Hidden messages do not count, and answering marks the conversation read for the sender.
  await db.message.update({where: {id: late.id}, data: {hiddenAt: new Date()}});
  assert.equal((await chat.unreadCounts(b)).total, 1);
  await chat.sendMessage(b, direct.id, 'answer');
  assert.equal((await chat.unreadCounts(b)).total, 0);
  assert.equal((await chat.unreadCounts(a)).total, 1);
  // The export holds the user's own messages only.
  const {chatExport} = await import('../src/lib/chat/export');
  const mine = await chatExport(b.userId);
  assert.deepEqual(mine.messages.map(row => row.body), ['answer']);
  assert.deepEqual(mine.conversations.map(row => [row.conversationId, row.kind]), [[direct.id, 'DIRECT']]);
  assert.equal(JSON.stringify(mine).includes('m1'), false);
  assert.deepEqual(await chatExport('missing-' + tag), {messages: [], conversations: [], blocks: []});
});
const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, wanted: string, ms: number, seen = {text: ''}) => {
  const decoder = new TextDecoder(), deadline = Date.now() + ms;
  while (!seen.text.includes(wanted) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())))]);
    if (!chunk || chunk.done) break;
    seen.text += decoder.decode(chunk.value);
  }
  return seen.text;
};
test('realtime: the stream carries only the viewer\'s conversations, follows membership and suppresses notifications while connected', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const {chatStream} = await import('../src/lib/chat/stream');
  const [a, b, outsider] = [await member('sa'), await member('sb'), await member('so')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const direct = await chat.openDirect(a, b.profileId);
  const abortB = new AbortController(), abortO = new AbortController();
  const streamB = await chatStream(b, abortB.signal, async () => true, 100);
  if (!streamB) {
    // Without Redis the stream is refused (the route answers 503) and sending still works; clients poll.
    assert.equal((await chat.sendMessage(a, direct.id, 'no redis')).body, 'no redis');
    assert.equal((await chat.listMessages(b, direct.id)).messages.length, 1);
    t.diagnostic('Redis is not available: pub/sub delivery was not exercised');
    return;
  }
  const streamO = await chatStream(outsider, abortO.signal, async () => true, 100);
  assert.ok(streamO);
  assert.equal(streamB.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(streamB.headers.get('x-accel-buffering'), 'no');
  const readerB = streamB.body!.getReader(), readerO = streamO.body!.getReader(), seenB = {text: ''}, seenO = {text: ''};
  assert.ok((await readUntil(readerB, 'event: ready', 3000, seenB)).includes('event: ready'));
  await readUntil(readerO, 'event: ready', 3000, seenO);
  const message = await chat.sendMessage(a, direct.id, 'live <b>hello</b>');
  const frames = await readUntil(readerB, message.id, 5000, seenB);
  const frame = frames.split('\n\n').find(part => part.includes(message.id)) ?? '';
  assert.ok(frame.startsWith('event: message\ndata: '), frame);
  assert.deepEqual(JSON.parse(frame.slice(frame.indexOf('data: ') + 6)), {type: 'message', conversationId: direct.id, message});
  assert.equal(await db.notification.count({where: {userId: b.userId, type: 'CHAT_MESSAGE'}}), 0, 'no notification for a member who is watching the stream');
  // A conversation joined after the stream opened is picked up through the profile channel.
  const group = await chat.createGroup(a, {title: 'Live', handles: [b.userId]});
  await readUntil(readerB, 'event: conversation', 5000, seenB);
  await new Promise(resolve => setTimeout(resolve, 300));
  const inGroup = await chat.sendMessage(a, group.id, 'group live');
  assert.ok((await readUntil(readerB, inGroup.id, 5000, seenB)).includes(inGroup.id));
  // Removal takes the subscription away again.
  await chat.leaveConversation(a, group.id, b.profileId);
  await new Promise(resolve => setTimeout(resolve, 400));
  const secret = await chat.sendMessage(a, group.id, 'after removal');
  await readUntil(readerB, secret.id, 600, seenB);
  assert.equal(seenB.text.includes(secret.id), false);
  // Heartbeats flow; the outsider never saw any of it.
  assert.ok((await readUntil(readerO, ': ping', 3000, seenO)).includes(': ping'));
  for (const id of [message.id, inGroup.id, secret.id]) assert.equal(seenO.text.includes(id), false);
  assert.equal(seenO.text.includes('event: message'), false);
  abortB.abort(); abortO.abort();
  const end = await Promise.race([readerB.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))]);
  assert.ok(end?.done, 'aborting the request closes the stream');
});
test('HTTP layer: session, same-origin mutations, bans and error codes', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {t.skip('BETTER_AUTH_SECRET is not set'); return;}
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  const [a, b] = [await member('ha'), await member('hb')];
  // A real session row plus the cookie Better Auth would have set for it (token signed with HMAC-SHA256).
  const cookieFor = async (who: Me) => {
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    await db.session.create({data: {id: randomUUID(), token, userId: who.userId, expiresAt: new Date(Date.now() + 3600_000)}});
    const value = encodeURIComponent(token + '.' + createHmac('sha256', secret).update(token).digest('base64'));
    return (origin.startsWith('https') ? '__Secure-' : '') + 'better-auth.session_token=' + value;
  };
  const [cookieA, cookieB] = [await cookieFor(a), await cookieFor(b)];
  const request = (path: string, cookie?: string, method = 'GET', body?: unknown, from: string | null = origin) => new Request(origin + path, {method,
    headers: {...(cookie ? {cookie} : {}), ...(from && method !== 'GET' ? {origin: from} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const unread = await import('../src/app/api/chat/unread/route');
  const directRoute = await import('../src/app/api/chat/direct/route');
  const messages = await import('../src/app/api/chat/conversations/[id]/messages/route');
  const conversation = await import('../src/app/api/chat/conversations/[id]/route');
  const blocks = await import('../src/app/api/chat/blocks/route');
  const stream = await import('../src/app/api/chat/stream/route');
  const probe = await unread.GET(request('/api/chat/unread', cookieA));
  if (probe.status === 401) {t.skip('this Better Auth version does not accept the hand-signed test cookie'); return;}
  assert.equal(probe.status, 200);
  assert.deepEqual(await probe.json(), {total: 0, conversations: 0, requests: 0});
  assert.equal(probe.headers.get('cache-control'), 'private, no-store');
  assert.equal((await unread.GET(request('/api/chat/unread'))).status, 401);
  assert.equal((await stream.GET(request('/api/chat/stream'))).status, 401);
  // Mutations need the session AND the site's own Origin.
  assert.equal((await directRoute.POST(request('/api/chat/direct', undefined, 'POST', {profileId: b.profileId}))).status, 401);
  assert.equal((await directRoute.POST(request('/api/chat/direct', cookieA, 'POST', {profileId: b.profileId}, 'https://evil.example'))).status, 403);
  assert.equal((await directRoute.POST(request('/api/chat/direct', cookieA, 'POST', {profileId: b.profileId}, null))).status, 403);
  assert.equal((await directRoute.POST(request('/api/chat/direct', cookieA, 'POST', {profile: 1}))).status, 400);
  const created = await directRoute.POST(request('/api/chat/direct', cookieA, 'POST', {profileId: b.profileId}));
  assert.equal(created.status, 201);
  const {id} = await created.json() as {id: string};
  assert.equal((await directRoute.POST(request('/api/chat/direct', cookieA, 'POST', {profileId: b.profileId}))).status, 200);
  const params = {params: Promise.resolve({id})};
  const posted = await messages.POST(request('/api/chat/conversations/' + id + '/messages', cookieA, 'POST', {body: ' hello https://swing.example '}), params);
  assert.equal(posted.status, 201);
  assert.equal(((await posted.json()) as {message: {body: string}}).message.body, 'hello https://swing.example');
  assert.deepEqual(await (await messages.POST(request('/api/chat/conversations/' + id + '/messages', cookieA, 'POST', {body: ''}), params)).json(), {error: 'INVALID_INPUT'});
  const listed = await messages.GET(request('/api/chat/conversations/' + id + '/messages?limit=5', cookieB), params);
  assert.equal(((await listed.json()) as {messages: unknown[]}).messages.length, 1);
  assert.equal((await messages.GET(request('/api/chat/conversations/' + id + '/messages?limit=abc', cookieB), params)).status, 400);
  assert.deepEqual(await (await unread.GET(request('/api/chat/unread', cookieB))).json(), {total: 0, conversations: 0, requests: 1});
  // A stranger to the conversation gets 404 over HTTP too.
  const c = await member('hc'), cookieC = await cookieFor(c);
  assert.equal((await messages.GET(request('/api/chat/conversations/' + id + '/messages', cookieC), params)).status, 404);
  assert.equal((await messages.POST(request('/api/chat/conversations/' + id + '/messages', cookieC, 'POST', {body: 'x'}), params)).status, 404);
  assert.equal((await conversation.GET(request('/api/chat/conversations/' + id, cookieC), params)).status, 404);
  // Accept, then block: the error does not say who blocked whom.
  assert.equal((await conversation.PATCH(request('/api/chat/conversations/' + id, cookieB, 'PATCH', {action: 'accept'}), params)).status, 200);
  assert.equal((await conversation.PATCH(request('/api/chat/conversations/' + id, cookieB, 'PATCH', {action: 'nope'}), params)).status, 400);
  assert.equal((await blocks.PUT(request('/api/chat/blocks', cookieB, 'PUT', {profileId: a.profileId}))).status, 200);
  for (const cookie of [cookieA, cookieB]) {
    const refused = await messages.POST(request('/api/chat/conversations/' + id + '/messages', cookie, 'POST', {body: 'x'}), params);
    assert.deepEqual([refused.status, await refused.json()], [403, {error: 'CHAT_UNAVAILABLE'}]);
  }
  assert.equal(((await (await blocks.GET(request('/api/chat/blocks', cookieB))).json()) as {blocks: unknown[]}).blocks.length, 1);
  assert.equal((await blocks.DELETE(request('/api/chat/blocks', cookieB, 'DELETE', {profileId: a.profileId}))).status, 200);
  // A ban cuts chat off: no sending, no reading, no stream.
  await db.user.update({where: {id: a.userId}, data: {bannedAt: new Date()}});
  const banned = await messages.POST(request('/api/chat/conversations/' + id + '/messages', cookieA, 'POST', {body: 'x'}), params);
  assert.deepEqual([banned.status, await banned.json()], [403, {error: 'BANNED'}]);
  assert.equal((await messages.GET(request('/api/chat/conversations/' + id + '/messages', cookieA), params)).status, 403);
  assert.equal((await unread.GET(request('/api/chat/unread', cookieA))).status, 403);
  assert.equal((await stream.GET(request('/api/chat/stream', cookieA))).status, 403);
  // A member without a profile is told to create one.
  await db.profile.delete({where: {id: c.profileId}});
  assert.deepEqual(await (await unread.GET(request('/api/chat/unread', cookieC))).json(), {error: 'PROFILE_REQUIRED'});
});
