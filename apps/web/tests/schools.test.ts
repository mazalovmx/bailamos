// School roles on the site. Run: pnpm --filter @dance/web exec tsx --test tests/schools.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db} from '@dance/db';
import {managedSchoolIds, managesSchool} from '../src/lib/schools/access';
import {eventAbility} from '../src/lib/permissions';
import {canPost} from '../src/lib/blog/permissions';
import {decideClaim} from '../src/lib/moderation';
config({path: '../../.env', quiet: true});
test('a school manager acts as owner of the school\'s events and posts, and only of those', () => {
  const members = [{profileId: 'school', role: 'OWNER'}];
  assert.equal(eventAbility('me', members, true).can('manage', 'Event'), true);
  assert.equal(eventAbility('me', members, true).can('delete', 'Event'), true);
  assert.equal(eventAbility('me', members, false).can('manage', 'Event'), false);
  // Without a profile nobody manages anything, school grant or not.
  assert.equal(eventAbility(undefined, members, true).can('manage', 'Event'), false);
  assert.equal(managesSchool({schoolIds: ['a']}, 'a'), true);
  assert.equal(managesSchool({schoolIds: ['a']}, 'b'), false);
  assert.equal(managesSchool({schoolIds: ['a']}, null), false);
  assert.equal(managesSchool(null, 'a'), false);
  const post = {profileId: 'school-a', publishedAt: null, hiddenAt: null};
  assert.equal(canPost({profile: {id: 'me'}, schoolIds: ['school-a']}, 'update', post), true);
  assert.equal(canPost({profile: {id: 'me'}, schoolIds: ['school-b']}, 'update', post), false);
  assert.equal(canPost({profile: {id: 'me'}}, 'read', post), false);
});
test('grants come from SchoolAdmin and from owning a school profile; an approved school claim opens the cabinet', {timeout: 30000}, async () => {
  const tag = 'sch-' + randomUUID().slice(0, 8), users = [tag + '-granted', tag + '-claimant', tag + '-staff'], profiles: string[] = [];
  try {
    for (const [index, id] of users.entries()) await db.user.create({data: {id, email: id + '@example.test', name: id, emailVerified: true, role: index === 2 ? 'ADMIN' : 'USER'}});
    const [granted, claimant, staff] = users;
    const a = await db.profile.create({data: {type: 'SCHOOL', handle: tag + '-a', name: 'School A'}}), b = await db.profile.create({data: {type: 'SCHOOL', handle: tag + '-b', name: 'School B'}});
    profiles.push(a.id, b.id);
    assert.deepEqual(await managedSchoolIds(granted), []);
    await db.schoolAdmin.create({data: {userId: granted, schoolProfileId: a.id}});
    assert.deepEqual(await managedSchoolIds(granted), [a.id]);
    const claim = await db.profileClaim.create({data: {profileId: b.id, userId: claimant}});
    await decideClaim(claim.id, true, staff);
    assert.deepEqual(await managedSchoolIds(claimant), [b.id]);
    assert.equal((await db.user.findUniqueOrThrow({where: {id: claimant}})).role, 'SCHOOL_ADMIN');
    assert.ok(await db.schoolAdmin.findUnique({where: {userId_schoolProfileId: {userId: claimant, schoolProfileId: b.id}}}));
    await db.schoolAdmin.deleteMany({where: {userId: granted}});
    assert.deepEqual(await managedSchoolIds(granted), []);
  } finally {
    await db.notification.deleteMany({where: {userId: {in: users}}});
    await db.profile.deleteMany({where: {id: {in: profiles}}});
    await db.auditLog.deleteMany({where: {actorUserId: {in: users}}});
    await db.user.deleteMany({where: {id: {in: users}}});
    await db.$disconnect();
  }
});
