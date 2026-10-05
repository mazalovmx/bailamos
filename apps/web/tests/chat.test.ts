// Chat in the monolith: request policy, blocks, membership gate, rooms, limits, unread counters, pagination, realtime and the HTTP layer.
// Database tests create their own users, profiles, events and conversations and remove them afterwards.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {mkdtempSync, readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
// Attachments are written to a throw-away directory by the local storage driver, whatever the environment configures.
const mediaDir = mkdtempSync(join(tmpdir(), 'dance-chat-'));
Object.assign(process.env, {MEDIA_STORAGE: 'local', MEDIA_LOCAL_DIR: mediaDir, MEDIA_SIGNING_SECRET: 'test-only-signing-secret'});
delete process.env.S3_PUBLIC_URL;
import {linkify, safeHref, LINK_REL} from '../src/lib/chat/linkify';
import {directKey, directPeer, requestRemaining} from '../src/lib/chat/policy';
const tag = randomUUID().slice(0, 8);
type Me = {userId: string; profileId: string; role: string; name: string; schoolIds?: string[]};
const userIds: string[] = [], eventIds: string[] = [], profileIds: string[] = [];
const code = (expected: string) => (error: unknown) => (error as {code?: string}).code === expected;
async function available(t: {skip(message: string): void}) {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`; return db;} catch {t.skip('PostgreSQL is not available'); return null;}
}
async function member(label: string, role: 'USER' | 'MODERATOR' | 'SCHOOL_ADMIN' = 'USER'): Promise<Me> {
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
    await db.profile.deleteMany({where: {id: {in: profileIds}}});
  } catch {/* the database was not available */}
  const {closeChatRealtime} = await import('../src/lib/chat/realtime');
  const {closeRedis} = await import('../src/lib/redis');
  await closeChatRealtime(); await closeRedis(); await db.$disconnect();
  await rm(mediaDir, {recursive: true, force: true});
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
  const [a, b, c, staff, local] = [await member('ga'), await member('gb'), await member('gc'), await member('gs', 'MODERATOR'), await member('gl', 'SCHOOL_ADMIN')];
  const city = await db.city.findFirstOrThrow();
  const before = await db.conversation.findUnique({where: {cityId: city.id}, select: {id: true}});
  const room = await chat.joinRoom(a, {cityId: city.id});
  assert.equal((await chat.joinRoom(b, {cityId: city.id})).id, room.id);
  await chat.joinRoom(staff, {cityId: city.id});
  await chat.joinRoom(local, {cityId: city.id});
  await assert.rejects(chat.joinRoom(a, {cityId: 'missing-' + tag}), code('NOT_FOUND'));
  const spam = await chat.sendMessage(a, room.id, 'city hello');
  assert.equal((await chat.listMessages(b, room.id, {limit: 1})).messages[0].body, 'city hello');
  await assert.rejects(chat.setMessageHidden(b, spam.id, true), code('FORBIDDEN'));
  await assert.rejects(chat.setMessageHidden(local, spam.id, true), code('FORBIDDEN'));
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
  assert.deepEqual([notes[0].userId, notes[0].url, notes[0].data], [b.userId, '/messages/' + direct.id, {conversationId: direct.id, messageId: sent[0], senderName: a.name, preview: 'm1'}]);
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
  // No pause here on purpose: a message sent in the very millisecond of the read mark is still newer than it.
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
  assert.equal(mine.messages.some(row=>row.body==='m1'), false);
  assert.deepEqual(await chatExport('missing-' + tag), {messages: [], conversations: [], blocks: []});
});
// One outstanding read per stream, and whatever it returns is always kept: a wait that times out must not swallow the next frame.
type Seen = {text: string; done?: boolean; pending?: Promise<void>};
const pump = (reader: ReadableStreamDefaultReader<Uint8Array>, seen: Seen) => seen.pending ??= reader.read().then(chunk => {
  seen.pending = undefined;
  if (chunk.done) seen.done = true; else seen.text += new TextDecoder().decode(chunk.value);
}, () => {seen.pending = undefined; seen.done = true;});
const waitFor = async (reader: ReadableStreamDefaultReader<Uint8Array>, seen: Seen, ready: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!ready() && !seen.done && Date.now() < deadline)
    await Promise.race([pump(reader, seen), new Promise(resolve => setTimeout(resolve, Math.max(1, deadline - Date.now())))]);
  return ready();
};
const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, wanted: string, ms: number, seen: Seen) => {
  await waitFor(reader, seen, () => seen.text.includes(wanted), ms);
  return seen.text;
};
const countUntil = (reader: ReadableStreamDefaultReader<Uint8Array>, wanted: string, count: number, ms: number, seen: Seen) =>
  waitFor(reader, seen, () => seen.text.split(wanted).length - 1 >= count, ms);
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
  const readerB = streamB.body!.getReader(), readerO = streamO.body!.getReader(), seenB: Seen = {text: ''}, seenO: Seen = {text: ''};
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
  // The membership event is forwarded only after the stream has subscribed to the new conversation: no waiting is needed.
  assert.equal(await countUntil(readerB, 'event: conversation', 1, 5000, seenB), true);
  const inGroup = await chat.sendMessage(a, group.id, 'group live');
  assert.ok((await readUntil(readerB, inGroup.id, 5000, seenB)).includes(inGroup.id));
  // Removal takes the subscription away again.
  await chat.leaveConversation(a, group.id, b.profileId);
  assert.equal(await countUntil(readerB, 'event: conversation', 2, 5000, seenB), true);
  const secret = await chat.sendMessage(a, group.id, 'after removal');
  await readUntil(readerB, secret.id, 600, seenB);
  assert.equal(seenB.text.includes(secret.id), false);
  // Heartbeats flow; the outsider never saw any of it.
  assert.ok((await readUntil(readerO, ': ping', 3000, seenO)).includes(': ping'));
  for (const id of [message.id, inGroup.id, secret.id]) assert.equal(seenO.text.includes(id), false);
  assert.equal(seenO.text.includes('event: message'), false);
  // Edits and deletions reach open threads as events of their own.
  const frameData = (text: string, marker: string) => JSON.parse((text.split('\n\n').find(part => part.includes(marker)) ?? '').split('data: ')[1] ?? '{}');
  const edited = await chat.editMessage(a, message.id, 'live, corrected');
  assert.deepEqual(frameData(await readUntil(readerB, 'event: edited', 5000, seenB), 'event: edited'), {type: 'edited', conversationId: direct.id, message: edited});
  await chat.deleteMessage(a, message.id);
  assert.deepEqual(frameData(await readUntil(readerB, 'event: deleted', 5000, seenB), 'event: deleted'), {type: 'deleted', conversationId: direct.id, messageId: message.id});
  // A sender the reader blocked: the reader's own stream marks the message, the sender's stream does not.
  const crew = await chat.createGroup(a, {title: 'Crew', handles: [b.userId, outsider.userId]});
  await chat.acceptConversation(outsider, crew.id);
  await chat.blockProfile(b, outsider.profileId);
  await readUntil(readerB, '"conversationId":""', 5000, seenB);
  const joined = '{"type":"conversation","conversationId":"' + crew.id + '"}';
  assert.ok((await readUntil(readerB, joined, 5000, seenB)).includes(joined) && (await readUntil(readerO, joined, 5000, seenO)).includes(joined));
  const fromBlocked = await chat.sendMessage(outsider, crew.id, 'you cannot ignore me');
  assert.equal(frameData(await readUntil(readerB, fromBlocked.id, 5000, seenB), fromBlocked.id).message?.blockedSender, true);
  assert.equal(frameData(await readUntil(readerO, fromBlocked.id, 5000, seenO), fromBlocked.id).message?.blockedSender, false);
  assert.equal(await db.notification.count({where: {userId: b.userId, type: 'CHAT_MESSAGE', data: {path: ['conversationId'], equals: crew.id}}}), 0);
  abortB.abort(); abortO.abort();
  // Frames queued before the abort are still delivered; after them the stream ends.
  assert.equal(await waitFor(readerB, seenB, () => !!seenB.done, 2000), true, 'aborting the request closes the stream');
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
  assert.deepEqual(await (await unread.GET(request('/api/chat/unread', cookieC))).json(), {total: 0, conversations: 0, requests: 0});
});
// ---------- Gaps closed after the first version: ordering, attachments, edit/delete, invitations, school chats, blocks in groups ----------
async function upload(who: Me, conversationId: string) {
  const {startUpload, completeUpload} = await import('../src/lib/media/upload');
  const {storage} = await import('../src/lib/storage');
  const user = {id: who.userId, role: who.role, profile: {id: who.profileId}, schoolIds: who.schoolIds};
  const body = await sharp({create: {width: 900, height: 600, channels: 3, background: '#a33'}}).withExif({IFD0: {Copyright: 'secret-owner'}}).jpeg().toBuffer();
  const ticket = await startUpload(user, {target: 'chat', targetId: conversationId, mime: 'image/jpeg', size: body.length});
  await storage().putObject(ticket.key, body, 'image/jpeg');
  return (await completeUpload(user, {key: ticket.key})).key;
}
async function school(label: string) {
  const {db} = await import('@dance/db');
  const profile = await db.profile.create({data: {type: 'SCHOOL', handle: 'chat-' + tag + '-' + label, name: 'School ' + label}});
  profileIds.push(profile.id);
  return profile;
}
async function manager(label: string, schoolId: string): Promise<Me> {
  const {db} = await import('@dance/db');
  const {managedSchoolIds} = await import('../src/lib/schools/access');
  const me = await member(label, 'SCHOOL_ADMIN');
  await db.schoolAdmin.create({data: {userId: me.userId, schoolProfileId: schoolId}});
  return {...me, schoolIds: await managedSchoolIds(me.userId)};
}
test('ordering does not depend on the wall clock: a new message is always newer than every read mark, join and message', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b] = [await member('ca'), await member('cb')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const direct = await chat.openDirect(a, b.profileId);
  // The clock "steps back": the stored read mark and the newest message are ahead of what new Date() returns from now on.
  const ahead = new Date(Date.now() + 5000);
  const first = await chat.sendMessage(a, direct.id, 'first');
  await db.message.update({where: {id: first.id}, data: {createdAt: ahead}});
  await db.conversationMember.updateMany({where: {conversationId: direct.id, profileId: b.profileId}, data: {lastReadAt: new Date(ahead.getTime() + 1000)}});
  const second = await chat.sendMessage(a, direct.id, 'second'), third = await chat.sendMessage(a, direct.id, 'third');
  assert.ok(Date.parse(second.createdAt) > ahead.getTime() + 1000 && Date.parse(third.createdAt) > Date.parse(second.createdAt));
  assert.deepEqual((await chat.listMessages(b, direct.id)).messages.map(row => row.body), ['first', 'second', 'third']);
  assert.equal((await chat.unreadCounts(b)).total, 2, 'both count as unread although the wall clock is behind the read mark');
  assert.deepEqual((await chat.listMessages(b, direct.id, {after: second.id})).messages.map(row => row.body), ['third']);
  // Reading covers everything that is there, even messages stamped later than the reader's clock.
  await chat.markRead(b, direct.id);
  assert.equal((await chat.unreadCounts(b)).total, 0);
  await chat.sendMessage(a, direct.id, 'fourth');
  assert.equal((await chat.unreadCounts(b)).total, 1);
  // The notification burst guard is tied to the read mark: a claim left behind cannot swallow the next burst.
  const {claimNotification} = await import('../src/lib/chat/realtime');
  assert.equal(await claimNotification(direct.id, b.userId, 1), true);
  assert.equal(await claimNotification(direct.id, b.userId, 2), true, 'a new read mark is a new claim');
  // Pure thread state used by the client for events and for polled pages.
  const {applyEvent, mergeMessages} = await import('../src/lib/chat/merge');
  const list = mergeMessages([third, second], [{...second, body: 'changed'}, {...first, createdAt: ahead.toISOString()}]);
  assert.deepEqual(list.map(row => row.body), ['first', 'changed', 'third']);
  const afterDelete = applyEvent(list, {type: 'deleted', conversationId: direct.id, messageId: second.id});
  assert.deepEqual([afterDelete[1].deleted, afterDelete[1].body, afterDelete[1].attachment], [true, null, null]);
  assert.deepEqual(applyEvent(list, {type: 'hidden', conversationId: direct.id, messageId: third.id, hidden: true})[2].body, null);
  assert.equal(applyEvent(list, {type: 'edited', conversationId: direct.id, message: {...third, body: 'x', editedAt: third.createdAt}})[2].body, 'x');
});
test('attachments: one image through the media pipeline, served to current members only, removed with the message and the conversation', {timeout: 120000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const {storage} = await import('../src/lib/storage');
  const keys = await import('../src/lib/media/keys');
  const {deleteProfileChatAttachments} = await import('../src/lib/chat/attachments');
  const [a, b, c, outsider] = [await member('aa'), await member('ab'), await member('ac'), await member('ao')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const group = await chat.createGroup(a, {title: 'Photos', handles: [b.userId, c.userId]});
  const exists = (key: string) => storage().exists(keys.variantKey(key, 800, 'webp'));
  // Who may upload: accepted members who may write. Not outsiders, not invited-but-not-accepted members.
  await assert.rejects(upload(outsider, group.id), code('NOT_FOUND'));
  await assert.rejects(upload(c, group.id), code('REQUEST_NOT_ACCEPTED'));
  const key = await upload(a, group.id);
  assert.deepEqual(keys.parseChatKey(key), {conversationId: group.id, profileId: a.profileId, uuid: key.split('/')[3]});
  // The stored files are re-encoded derivatives without metadata.
  const stored = await storage().getObject(keys.variantKey(key, 800, 'webp'));
  const bytes = Buffer.from(await new Response(stored!.body).arrayBuffer()), meta = await sharp(bytes).metadata();
  assert.deepEqual([meta.format, meta.width, meta.exif, bytes.includes('secret-owner')], ['webp', 800, undefined, false]);
  // The public media route does not know the chat prefix at all.
  assert.equal(keys.isBaseKey(key), false);
  assert.equal(keys.parseVariantKey(keys.variantKey(key, 800, 'webp')), null);
  const publicRoute = await import('../src/app/api/media/file/[...key]/route');
  for (const path of [key, keys.variantKey(key, 800, 'webp')])
    assert.equal((await publicRoute.GET(new Request('http://localhost/api/media/file/' + path), {params: Promise.resolve({key: path.split('/')})})).status, 404);
  // The key works for its uploader, in its conversation, once.
  const other = await chat.createGroup(a, {title: 'Elsewhere', handles: [b.userId]});
  await assert.rejects(chat.sendMessage(a, other.id, 'x', key), code('INVALID_INPUT'));
  await assert.rejects(chat.sendMessage(b, group.id, 'x', key), code('INVALID_INPUT'));
  await assert.rejects(chat.sendMessage(a, group.id, 'x', key.replace(/.$/, key.endsWith('0') ? '1' : '0')), code('INVALID_INPUT'));
  await assert.rejects(chat.sendMessage(a, group.id, 'x', 'img/' + a.profileId + '/' + key.split('/')[3]), code('INVALID_INPUT'));
  const photo = await chat.sendMessage(a, group.id, '', key);
  assert.deepEqual([photo.body, photo.attachment?.src], ['', '/api/chat/attachments/' + photo.id + '?w=800&f=webp']);
  assert.equal(JSON.stringify(photo).includes(key), false, 'the storage key never reaches a client');
  await assert.rejects(chat.sendMessage(a, group.id, 'again', key), code('INVALID_INPUT'));
  await assert.rejects(chat.sendMessage(a, group.id, '', undefined), {name: 'ZodError'});
  assert.equal((await chat.inbox(b)).conversations.find(row => row.id === group.id)?.lastMessage?.attachment, true);
  // Reading: members yes; outsiders, removed members and unknown ids no.
  assert.equal(await chat.attachmentKeyFor(b, photo.id), key);
  assert.equal(await chat.attachmentKeyFor(c, photo.id), key, 'an invited member reads the group they were invited to');
  await assert.rejects(chat.attachmentKeyFor(outsider, photo.id), code('NOT_FOUND'));
  await assert.rejects(chat.attachmentKeyFor(a, 'missing-' + tag), code('NOT_FOUND'));
  await chat.leaveConversation(a, group.id, c.profileId);
  await assert.rejects(chat.attachmentKeyFor(c, photo.id), code('NOT_FOUND'));
  // A hidden message does not serve its image; restoring brings it back.
  await chat.setMessageHidden(a, photo.id, true);
  await assert.rejects(chat.attachmentKeyFor(b, photo.id), code('NOT_FOUND'));
  assert.equal((await chat.listMessages(b, group.id)).messages[0].attachment, null);
  await chat.setMessageHidden(a, photo.id, false);
  assert.equal(await chat.attachmentKeyFor(b, photo.id), key);
  // Deleting the message erases the files.
  await chat.deleteMessage(a, photo.id);
  await assert.rejects(chat.attachmentKeyFor(b, photo.id), code('NOT_FOUND'));
  assert.equal(await exists(key), false);
  assert.deepEqual(await db.message.findUniqueOrThrow({where: {id: photo.id}, select: {body: true, attachmentKey: true}}), {body: '', attachmentKey: null});
  // Strangers cannot push images into requests: neither the upload nor the message is accepted until the request is.
  const request = await chat.openDirect(a, outsider.profileId);
  await assert.rejects(upload(a, request.id), code('ATTACHMENT_NOT_ALLOWED'));
  const second = await upload(a, group.id);
  await assert.rejects(chat.sendMessage(a, request.id, 'look', second.replace(group.id, request.id)), code('ATTACHMENT_NOT_ALLOWED'));
  assert.equal((await chat.conversationDetail(a, request.id)).canAttach, false);
  await chat.sendMessage(a, request.id, 'hello');
  await chat.acceptConversation(outsider, request.id);
  assert.equal((await chat.conversationDetail(a, request.id)).canAttach, true);
  assert.equal((await chat.sendMessage(a, request.id, 'now with a photo', await upload(a, request.id))).attachment !== null, true);
  // Account deletion hook and conversation removal take the stored files with them.
  const mine = await chat.sendMessage(a, group.id, 'keep', second), theirs = await chat.sendMessage(b, group.id, 'b', await upload(b, group.id));
  const theirKey = await chat.attachmentKeyFor(a, theirs.id);
  assert.deepEqual(await deleteProfileChatAttachments(a.profileId), {attachments: 2});
  assert.deepEqual([await exists(second), await exists(theirKey)], [false, true]);
  await assert.rejects(chat.attachmentKeyFor(b, mine.id), code('NOT_FOUND'));
  await chat.leaveConversation(a, group.id); await chat.leaveConversation(b, group.id);
  assert.deepEqual([await db.conversation.count({where: {id: group.id}}), await exists(theirKey)], [0, false]);
  const {limits} = await import('../src/lib/chat/policy');
  assert.ok(limits.attach.limit / limits.attach.windowSec < limits.send.limit / limits.send.windowSec, 'attachments have a tighter budget than text');
});
test('own messages: edit within 15 minutes, delete at any time; polling sees every change to older messages', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b, outsider] = [await member('xa'), await member('xb'), await member('xo')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const group = await chat.createGroup(a, {title: 'Edits', handles: [b.userId]});
  const one = await chat.sendMessage(b, group.id, 'frist'), two = await chat.sendMessage(b, group.id, 'second');
  await chat.sendMessage(a, group.id, 'third');
  assert.deepEqual([one.editedAt, one.deleted], [null, false]);
  const fixed = await chat.editMessage(b, one.id, '  first ');
  assert.deepEqual([fixed.body, typeof fixed.editedAt, fixed.id], ['first', 'string', one.id]);
  await assert.rejects(chat.editMessage(a, one.id, 'not mine'), code('FORBIDDEN'));
  await assert.rejects(chat.editMessage(outsider, one.id, 'x'), code('NOT_FOUND'));
  await assert.rejects(chat.editMessage(b, one.id, '   '), {name: 'ZodError'});
  await assert.rejects(chat.editMessage(b, 'missing-' + tag, 'x'), code('NOT_FOUND'));
  // A hidden message cannot be rewritten; the room admin keeps hide and restore.
  await chat.setMessageHidden(a, two.id, true);
  await assert.rejects(chat.editMessage(b, two.id, 'sneaky'), code('EDIT_UNAVAILABLE'));
  // Polling fallback: re-reading from the oldest shown message returns the current state of all of them.
  const polled = async () => (await chat.listMessages(a, group.id, {from: one.id, limit: 100})).messages.map(row => [row.body, row.hidden, row.deleted, !!row.editedAt]);
  assert.deepEqual(await polled(), [['first', false, false, true], [null, true, false, false], ['third', false, false, false]]);
  await chat.setMessageHidden(a, two.id, false);
  assert.deepEqual((await polled())[1], ['second', false, false, false], 'a restored older message is seen without the stream');
  assert.deepEqual(await chat.listMessages(a, group.id, {from: two.id, limit: 1}), {messages: [(await chat.listMessages(a, group.id)).messages[1]], hasMore: true});
  await assert.rejects(chat.listMessages(a, group.id, {from: one.id, after: two.id}), {name: 'ZodError'});
  // Delete: own only, idempotent; the text is erased from the row, the counters and the notification preview.
  await chat.markRead(a, group.id);
  const late = await chat.sendMessage(b, group.id, 'secret words');
  assert.equal((await chat.unreadCounts(a)).total, 1);
  assert.equal(JSON.stringify(await db.notification.findMany({where: {userId: a.userId}})).includes('secret words'), true);
  await assert.rejects(chat.deleteMessage(a, late.id), code('FORBIDDEN'));
  await assert.rejects(chat.deleteMessage(outsider, late.id), code('NOT_FOUND'));
  assert.deepEqual(await chat.deleteMessage(b, late.id), {id: late.id, deleted: true});
  assert.deepEqual(await chat.deleteMessage(b, late.id), {id: late.id, deleted: true});
  assert.equal((await chat.unreadCounts(a)).total, 0, 'a deleted message is not unread');
  assert.equal(JSON.stringify(await db.notification.findMany({where: {userId: a.userId}})).includes('secret words'), false);
  assert.equal((await db.message.findUniqueOrThrow({where: {id: late.id}})).body, '');
  const last = (await chat.listMessages(a, group.id)).messages.at(-1)!;
  assert.deepEqual([last.id, last.deleted, last.hidden, last.body, last.editedAt], [late.id, true, false, null, null]);
  const preview = (await chat.inbox(a)).conversations.find(row => row.id === group.id)?.lastMessage;
  assert.deepEqual([preview?.deleted, preview?.body], [true, null]);
  await assert.rejects(chat.editMessage(b, late.id, 'undelete'), code('EDIT_UNAVAILABLE'));
  // The edit window is 15 minutes from sending; deleting has no time limit.
  await db.message.update({where: {id: two.id}, data: {createdAt: new Date(Date.now() - 16 * 60_000)}});
  await assert.rejects(chat.editMessage(b, two.id, 'too late'), code('EDIT_WINDOW_CLOSED'));
  await chat.deleteMessage(b, two.id);
  // The export shows the author what is left of their messages.
  const {chatExport} = await import('../src/lib/chat/export');
  assert.deepEqual((await chatExport(b.userId)).messages.map(row => [row.body, !!row.deletedAt, !!row.editedAt]).sort(), [['', true, false], ['', true, false], ['first', false, true]]);
});
test('group invitations appear in the notification centre and are read with the conversation', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const {renderNotification} = await import('../src/lib/notifications/render');
  const [a, b, c] = [await member('ia'), await member('ib'), await member('ic')];
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const group = await chat.createGroup(a, {title: 'Friday practice', handles: [b.userId]});
  await chat.inviteMember(a, group.id, {handle: c.userId});
  await assert.rejects(chat.inviteMember(a, group.id, {handle: c.userId}), code('ALREADY_MEMBER'));
  for (const who of [b, c]) {
    const notes: {data: unknown; url: string | null; readAt: Date | null}[] = await db.notification.findMany({where: {userId: who.userId, type: 'GROUP_INVITE'}});
    assert.equal(notes.length, 1, 'known member and stranger are both told, once');
    assert.deepEqual([notes[0].data, notes[0].url, notes[0].readAt], [{conversationId: group.id, title: 'Friday practice', inviterName: a.name}, '/messages/' + group.id, null]);
    for (const [locale, word] of [['en', 'Invitation'], ['es', 'Invitación'], ['ru', 'Приглашение']]) {
      const text = renderNotification(locale, 'GROUP_INVITE', notes[0].data);
      assert.ok(text.title.startsWith(word) && text.body.includes(a.name) && text.body.includes('Friday practice'), locale + ': ' + JSON.stringify(text));
    }
  }
  assert.equal(await db.notification.count({where: {userId: a.userId, type: 'GROUP_INVITE'}}), 0);
  await chat.markRead(c, group.id);
  assert.equal(await db.notification.count({where: {userId: c.userId, type: 'GROUP_INVITE', readAt: null}}), 0);
  // The group admin can rename the group; members cannot.
  assert.deepEqual(await chat.renameConversation(a, group.id, {title: ' Saturday practice '}), {id: group.id, title: 'Saturday practice'});
  await assert.rejects(chat.renameConversation(b, group.id, {title: 'Mine now'}), code('FORBIDDEN'));
  await assert.rejects(chat.renameConversation(a, group.id, {title: ' '}), {name: 'ZodError'});
  assert.equal((await chat.conversationDetail(b, group.id)).title, 'Saturday practice');
});
test('school chats: managers read, moderate and post as the school; other schools and ordinary members get nothing extra', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const {managedSchoolIds} = await import('../src/lib/schools/access');
  const [schoolA, schoolB] = [await school('sa'), await school('sb')];
  const [boss, rival, pupil, guest] = [await manager('sm', schoolA.id), await manager('sr', schoolB.id), await member('sp'), await member('sg')];
  const create = (schoolId: string, title: string, members: Me[]) => db.conversation.create({data: {kind: 'GROUP', title, schoolProfileId: schoolId,
    members: {create: [{profileId: schoolId, admin: true}, ...members.map(row => ({profileId: row.profileId}))]}}});
  // Created the way the admin school cabinet does it: the school profile is the admin member.
  const [roomA, roomB] = [await create(schoolA.id, 'Beginners A', [pupil]), await create(schoolB.id, 'Beginners B', [pupil])];
  assert.deepEqual(boss.schoolIds, [schoolA.id]);
  // Inbox: a separate section for the manager, nothing in their personal list; the pupil sees ordinary groups.
  const box = await chat.inbox(boss);
  assert.deepEqual([box.school.map(row => [row.id, row.school]), box.conversations.length, box.requests.length], [[[roomA.id, {id: schoolA.id, name: schoolA.name}]], 0, 0]);
  const pupilBox = await chat.inbox(pupil);
  assert.deepEqual([pupilBox.school.length, pupilBox.conversations.map(row => row.school)], [0, [null, null]]);
  // Posting as the school: the sender is the school, the acting manager is recorded only in the audit log.
  const hello = await chat.sendMessage(boss, roomA.id, 'Class moved to 19:00');
  assert.deepEqual([hello.sender.id, hello.sender.name], [schoolA.id, schoolA.name]);
  const audit = await db.auditLog.findMany({where: {action: 'SCHOOL_CHAT_MESSAGE', targetId: hello.id}});
  assert.deepEqual(audit.map(row => [row.actorUserId, row.targetType, row.data]), [[boss.userId, 'Message', {conversationId: roomA.id, schoolProfileId: schoolA.id}]]);
  const seen = JSON.stringify([await chat.listMessages(pupil, roomA.id), await chat.conversationDetail(pupil, roomA.id), await chat.inbox(pupil)]);
  assert.equal(seen.includes(boss.profileId) || seen.includes(boss.name) || seen.includes(boss.userId), false, 'members see the school, never the manager');
  assert.equal((await chat.unreadCounts(pupil)).total, 1);
  const detail = await chat.conversationDetail(boss, roomA.id);
  assert.deepEqual([detail.actingProfileId, detail.school?.id, detail.admin, detail.canModerate, detail.canAttach], [schoolA.id, schoolA.id, true, true, true]);
  assert.deepEqual((await chat.conversationDetail(pupil, roomA.id)).school, null);
  // The school's unread counter and read mark are the manager's too.
  const question = await chat.sendMessage(pupil, roomA.id, 'Which studio?');
  assert.deepEqual(await chat.unreadCounts(boss), {total: 1, conversations: 1, requests: 0});
  assert.equal((await chat.inbox(boss)).school[0].unread, 1);
  await chat.markRead(boss, roomA.id);
  assert.equal((await chat.unreadCounts(boss)).total, 0);
  // Moderation: hide, edit the school's messages, rename, add and remove members by handle.
  await chat.setMessageHidden(boss, question.id, true);
  assert.equal((await chat.listMessages(pupil, roomA.id)).messages[1].hidden, true);
  await chat.setMessageHidden(boss, question.id, false);
  assert.equal((await chat.editMessage(boss, hello.id, 'Class moved to 19:30')).sender.id, schoolA.id);
  await assert.rejects(chat.editMessage(boss, question.id, 'words in their mouth'), code('FORBIDDEN'));
  await chat.renameConversation(boss, roomA.id, {title: 'Beginners A, Monday'});
  await db.follow.create({data: {userId: guest.userId, profileId: schoolA.id}});
  assert.deepEqual(await chat.inviteMember(boss, roomA.id, {handle: guest.userId}), {profileId: guest.profileId});
  const invitation = await db.notification.findFirstOrThrow({where: {userId: guest.userId, type: 'GROUP_INVITE'}});
  assert.deepEqual(invitation.data, {conversationId: roomA.id, title: 'Beginners A, Monday', inviterName: schoolA.name});
  assert.equal((await chat.inbox(guest)).conversations[0]?.id, roomA.id, 'a follower of the school joins without a request');
  await chat.leaveConversation(boss, roomA.id, {handle: guest.userId});
  await assert.rejects(chat.listMessages(guest, roomA.id), code('NOT_FOUND'));
  await assert.rejects(chat.leaveConversation(boss, roomA.id), code('FORBIDDEN'));
  await assert.rejects(chat.leaveConversation(boss, roomA.id, schoolA.id), code('FORBIDDEN'));
  assert.deepEqual((await db.auditLog.findMany({where: {actorUserId: boss.userId, targetId: roomA.id}, orderBy: {createdAt: 'asc'}})).map(row => row.action),
    ['SCHOOL_CHAT_RENAME', 'SCHOOL_CHAT_MEMBER_ADD', 'SCHOOL_CHAT_MEMBER_REMOVE']);
  // Ordinary members get no moderation rights from being in a school chat.
  await assert.rejects(chat.setMessageHidden(pupil, hello.id, true), code('FORBIDDEN'));
  await assert.rejects(chat.inviteMember(pupil, roomA.id, {handle: guest.userId}), code('FORBIDDEN'));
  await assert.rejects(chat.renameConversation(pupil, roomA.id, {title: 'Hijacked'}), code('FORBIDDEN'));
  await assert.rejects(chat.leaveConversation(pupil, roomA.id, schoolA.id), code('FORBIDDEN'));
  // School isolation: the manager of A, and anybody claiming a school that is not the conversation's, finds nothing in B.
  const inB = await chat.sendMessage(rival, roomB.id, 'B only');
  for (const who of [boss, {...boss, role: 'ADMIN'}, {...guest, schoolIds: [schoolA.id]}])
    for (const attempt of [() => chat.listMessages(who, roomB.id), () => chat.conversationDetail(who, roomB.id), () => chat.sendMessage(who, roomB.id, 'hi'),
      () => chat.markRead(who, roomB.id), () => chat.setMessageHidden(who, inB.id, true), () => chat.editMessage(who, inB.id, 'x'), () => chat.deleteMessage(who, inB.id),
      () => chat.attachmentKeyFor(who, inB.id), () => chat.inviteMember(who, roomB.id, {handle: guest.userId}), () => chat.renameConversation(who, roomB.id, {title: 'Mine'}),
      () => chat.leaveConversation(who, roomB.id, pupil.profileId), () => upload(who, roomB.id)]) await assert.rejects(attempt(), code('NOT_FOUND'));
  assert.equal((await chat.inbox(boss)).school.some(row => row.id === roomB.id), false);
  assert.deepEqual([(await chat.conversationIds(boss)).includes(roomA.id), (await chat.conversationIds(boss)).includes(roomB.id)], [true, false]);
  assert.equal((await db.message.findUniqueOrThrow({where: {id: inB.id}})).body, 'B only');
  // The school profile's membership elsewhere (a group it was merely added to) is not opened to its managers.
  const foreign = await db.conversation.create({data: {kind: 'GROUP', title: 'Teachers', members: {create: [{profileId: schoolA.id}, {profileId: guest.profileId, admin: true}]}}});
  await assert.rejects(chat.listMessages(boss, foreign.id), code('NOT_FOUND'));
  // A revoked grant ends everything at once, including the live stream's subscriptions.
  await db.schoolAdmin.deleteMany({where: {userId: boss.userId}});
  const revoked = {...boss, schoolIds: await managedSchoolIds(boss.userId)};
  await assert.rejects(chat.listMessages(revoked, roomA.id), code('NOT_FOUND'));
  assert.equal((await chat.inbox(revoked)).school.length, 0);
  assert.equal((await chat.conversationIds(boss)).includes(roomA.id), false);
});
test('blocks inside groups: messages of a blocked sender are flagged for the blocker only', {timeout: 60000}, async t => {
  const db = await available(t); if (!db) return;
  const chat = await import('../src/lib/chat/service');
  const [a, b, c] = [await member('za'), await member('zb'), await member('zc')];
  for (const who of [b, c]) await db.follow.create({data: {userId: who.userId, profileId: a.profileId}});
  const group = await chat.createGroup(a, {title: 'Mixed', handles: [b.userId, c.userId]});
  await chat.sendMessage(a, group.id, 'welcome');
  await chat.blockProfile(b, c.profileId);
  const rude = await chat.sendMessage(c, group.id, 'hello again');
  assert.equal(rude.blockedSender, false, 'the sender is told nothing');
  assert.deepEqual((await chat.listMessages(b, group.id)).messages.map(row => [row.sender.id, row.blockedSender]), [[a.profileId, false], [c.profileId, true]]);
  for (const who of [a, c]) assert.deepEqual((await chat.listMessages(who, group.id)).messages.map(row => row.blockedSender), [false, false]);
  const preview = (await chat.inbox(b)).conversations[0].lastMessage;
  assert.deepEqual([preview?.blockedSender, preview?.body], [true, null]);
  assert.equal((await chat.inbox(a)).conversations[0].lastMessage?.body, 'hello again');
  assert.equal(await db.notification.count({where: {userId: b.userId, type: 'CHAT_MESSAGE'}}), 1, 'only the welcome message notified the blocker');
  const view = JSON.stringify([await chat.conversationDetail(c, group.id), await chat.listMessages(c, group.id), await chat.inbox(c)]);
  assert.equal(/"blockedSender":true|"blockedByMe":true/.test(view), false);
  await chat.unblockProfile(b, c.profileId);
  assert.deepEqual((await chat.listMessages(b, group.id)).messages.map(row => row.blockedSender), [false, false]);
});
test('HTTP layer: editing, deleting, renaming and the member-only attachment route', {timeout: 120000}, async t => {
  const db = await available(t); if (!db) return;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {t.skip('BETTER_AUTH_SECRET is not set'); return;}
  const chat = await import('../src/lib/chat/service');
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  const [a, b, c] = [await member('pa'), await member('pb'), await member('pc')];
  const cookieFor = async (who: Me) => {
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    await db.session.create({data: {id: randomUUID(), token, userId: who.userId, expiresAt: new Date(Date.now() + 3600_000)}});
    return (origin.startsWith('https') ? '__Secure-' : '') + 'better-auth.session_token=' + encodeURIComponent(token + '.' + createHmac('sha256', secret).update(token).digest('base64'));
  };
  const [cookieA, cookieB, cookieC] = [await cookieFor(a), await cookieFor(b), await cookieFor(c)];
  const request = (path: string, cookie?: string, method = 'GET', body?: unknown) => new Request(origin + path, {method,
    headers: {...(cookie ? {cookie} : {}), ...(method !== 'GET' ? {origin} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const unread = await import('../src/app/api/chat/unread/route');
  if ((await unread.GET(request('/api/chat/unread', cookieA))).status === 401) {t.skip('this Better Auth version does not accept the hand-signed test cookie'); return;}
  const messages = await import('../src/app/api/chat/conversations/[id]/messages/route');
  const conversation = await import('../src/app/api/chat/conversations/[id]/route');
  const members = await import('../src/app/api/chat/conversations/[id]/members/route');
  const one = await import('../src/app/api/chat/messages/[id]/route');
  const attachments = await import('../src/app/api/chat/attachments/[messageId]/route');
  await db.follow.create({data: {userId: b.userId, profileId: a.profileId}});
  const group = await chat.createGroup(a, {title: 'HTTP', handles: [b.userId]}), params = {params: Promise.resolve({id: group.id})};
  const posted = await messages.POST(request('/api/chat/conversations/' + group.id + '/messages', cookieA, 'POST', {body: 'with photo', attachmentKey: await upload(a, group.id)}), params);
  assert.equal(posted.status, 201);
  const {message} = await posted.json() as {message: {id: string; attachment: {src: string}}};
  const file = (cookie: string | undefined, query = '') => attachments.GET(request('/api/chat/attachments/' + message.id + query, cookie), {params: Promise.resolve({messageId: message.id})});
  const served = await file(cookieB, '?w=320&f=avif');
  assert.deepEqual([served.status, served.headers.get('content-type'), served.headers.get('cache-control'), served.headers.get('x-content-type-options')],
    [200, 'image/avif', 'private, max-age=3600', 'nosniff']);
  assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).width, 320);
  assert.equal((await file(cookieA)).headers.get('content-type'), 'image/webp');
  assert.deepEqual([(await file(undefined)).status, (await file(cookieC)).status, (await file(cookieB, '?w=999')).status, (await file(cookieB, '?f=svg')).status], [401, 404, 400, 400]);
  // Edit and delete through the message route; both need the session and the site's own Origin.
  const target = {params: Promise.resolve({id: message.id})};
  const patched = await one.PATCH(request('/api/chat/messages/' + message.id, cookieA, 'PATCH', {body: 'caption fixed'}), target);
  assert.equal(((await patched.json()) as {message: {body: string}}).message.body, 'caption fixed');
  assert.equal((await one.PATCH(request('/api/chat/messages/' + message.id, cookieB, 'PATCH', {body: 'not mine'}), target)).status, 403);
  assert.equal((await one.PATCH(request('/api/chat/messages/' + message.id, cookieA, 'PATCH', {body: 'x', hidden: true}), target)).status, 400);
  assert.equal((await one.DELETE(request('/api/chat/messages/' + message.id, cookieC, 'DELETE', {}), target)).status, 404);
  assert.equal((await one.DELETE(request('/api/chat/messages/' + message.id, cookieB, 'DELETE', {}), target)).status, 403);
  assert.equal((await one.DELETE(new Request(origin + '/api/chat/messages/' + message.id, {method: 'DELETE', headers: {cookie: cookieA, origin: 'https://evil.example'}}), target)).status, 403);
  assert.deepEqual(await (await one.DELETE(request('/api/chat/messages/' + message.id, cookieA, 'DELETE', {}), target)).json(), {id: message.id, deleted: true});
  assert.equal((await file(cookieB)).status, 404, 'a deleted message serves no image');
  // Rename, the polling page and removal by handle.
  assert.equal((await conversation.PATCH(request('/api/chat/conversations/' + group.id, cookieA, 'PATCH', {action: 'rename', title: 'HTTP renamed'}), params)).status, 200);
  assert.equal((await conversation.PATCH(request('/api/chat/conversations/' + group.id, cookieB, 'PATCH', {action: 'rename', title: 'No'}), params)).status, 403);
  const page = await (await messages.GET(request('/api/chat/conversations/' + group.id + '/messages?from=' + message.id, cookieB), params)).json() as {messages: {deleted: boolean}[]};
  assert.deepEqual(page.messages.map(row => row.deleted), [true]);
  assert.equal((await members.DELETE(request('/api/chat/conversations/' + group.id + '/members', cookieA, 'DELETE', {handle: b.userId}), params)).status, 200);
  assert.equal((await messages.GET(request('/api/chat/conversations/' + group.id + '/messages', cookieB), params)).status, 404);
});
