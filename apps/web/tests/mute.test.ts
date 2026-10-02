// Per-conversation mute and localized city labels. Run: pnpm --filter @dance/web exec tsx --test tests/mute.test.ts
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db} from '@dance/db';
import {conversationDetail, sendMessage, setMuted} from '../src/lib/chat/service';
import {cityLabeler} from '../src/lib/catalogue/data';
import {closeRedis} from '../src/lib/redis';
config({path: '../../.env', quiet: true});
after(async () => {await closeRedis(); await db.$disconnect();});
test('a muted conversation raises no notification for that member, and only for that member', {timeout: 30000}, async () => {
  const tag = 'mute-' + randomUUID().slice(0, 8), users = ['a', 'b', 'c'].map(name => tag + '-' + name);
  let conversationId = '';
  try {
    const profiles: string[] = [];
    for (const id of users) {
      await db.user.create({data: {id, email: id + '@example.test', name: id, emailVerified: true}});
      profiles.push((await db.profile.create({data: {userId: id, type: 'DANCER', handle: id, name: id}})).id);
    }
    const now = new Date();
    conversationId = (await db.conversation.create({data: {kind: 'GROUP', title: tag,
      members: {create: profiles.map((profileId, index) => ({profileId, admin: index === 0, accepted: true, joinedAt: now, lastReadAt: now}))}}})).id;
    const me = (index: number) => ({userId: users[index], profileId: profiles[index], role: 'USER', name: users[index]});
    assert.equal((await conversationDetail(me(1), conversationId)).muted, false);
    assert.deepEqual(await setMuted(me(1), conversationId, true), {muted: true});
    assert.equal((await conversationDetail(me(1), conversationId)).muted, true);
    await sendMessage(me(0), conversationId, 'Practice tonight?');
    const notified = await db.notification.findMany({where: {userId: {in: users}, type: 'CHAT_MESSAGE'}, select: {userId: true}});
    assert.deepEqual(notified.map(row => row.userId), [users[2]]);
    // Someone who is not a member cannot mute, and learns nothing about the conversation.
    const outsider = {userId: 'nobody', profileId: 'nobody', role: 'USER', name: 'nobody'};
    await assert.rejects(setMuted(outsider, conversationId, true));
  } finally {
    await db.notification.deleteMany({where: {userId: {in: users}}});
    if (conversationId) await db.conversation.deleteMany({where: {id: conversationId}});
    await db.user.deleteMany({where: {id: {in: users}}});
  }
});
test('city labels follow the reader language and fall back to the stored name', async () => {
  const moscow = await db.city.findUnique({where: {slug: 'moscow'}, select: {name: true}});
  if (!moscow) return;
  assert.equal((await cityLabeler('en'))(moscow.name), 'Moscow');
  assert.equal((await cityLabeler('ru'))(moscow.name), 'Москва');
  assert.equal((await cityLabeler('en'))('Atlantis'), 'Atlantis');
  assert.equal((await cityLabeler('en'))(null), '');
});
