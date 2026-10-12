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
import {createSchool, grantSchoolAdmin} from '../src/lib/schools/manage';
import {adminAccessIdentity, schoolPermissions} from '@dance/db';
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

test('school creation, multiple scopes, delegation and last-manager protection preserve platform roles', {timeout: 60000}, async () => {
  const tag = 'scoped-' + randomUUID().slice(0, 8), ids = ['creator', 'member', 'global', 'moderator', 'second'].map(name => tag + '-' + name);
  const schoolIds: string[] = [], invitedEmails = [tag + '-new@example.test', tag + '-blocked@example.test'];
  try {
    const city = await db.city.findFirstOrThrow();
    for (const [index, id] of ids.entries()) await db.user.create({data: {id, name: id, email: id + '@example.test',
      emailVerified: true, role: index === 2 ? 'ADMIN' : index === 3 ? 'MODERATOR' : 'USER',
      profile: {create: {type: 'DANCER', name: id, handle: id, cityId: city.id}}}});
    const [creator, member, global, moderator, second] = ids;
    await db.session.create({data: {id: tag, token: tag, userId: creator, expiresAt: new Date(Date.now() + 60000)}});
    const a = await createSchool(creator, {name: 'Scoped A', handle: tag + '-a', cityId: city.id}); schoolIds.push(a.id);
    const b = await createSchool(moderator, {name: 'Scoped B', handle: tag + '-b', cityId: city.id}); schoolIds.push(b.id);
    assert.equal((await db.user.findUniqueOrThrow({where: {id: creator}})).role, 'USER');
    assert.equal((await db.user.findUniqueOrThrow({where: {id: moderator}})).role, 'MODERATOR');
    assert.equal(await db.session.count({where: {userId: creator}}), 1, 'rights appear without ending the current web session');
    assert.equal((await schoolPermissions(creator, a.id)).canManageAdmins, true);
    assert.equal((await adminAccessIdentity(creator))?.hasSchoolAccess, true);
    await assert.rejects(schoolPermissions(creator, b.id), /FORBIDDEN/);
    await grantSchoolAdmin(creator, a.id, {email: member + '@example.test'});
    await grantSchoolAdmin(moderator, b.id, {email: member + '@example.test', role: 'MANAGER'});
    assert.deepEqual(new Set(await managedSchoolIds(member)), new Set([a.id, b.id]));
    assert.equal((await schoolPermissions(member, a.id)).canManageAdmins, false);
    assert.equal((await schoolPermissions(member, b.id)).canManageAdmins, true);
    await assert.rejects(grantSchoolAdmin(member, a.id, {email: invitedEmails[0]}), /FORBIDDEN/);
    const invited = await grantSchoolAdmin(member, b.id, {email: '  ' + invitedEmails[0].toUpperCase() + '  '});
    assert.equal(invited.created, true);
    const pending = await db.user.findUniqueOrThrow({where: {id: invited.id}});
    assert.equal(pending.role, 'USER'); assert.equal(pending.emailVerified, false);
    assert.equal(await db.account.count({where: {userId: pending.id}}), 0);
    assert.equal(await db.session.count({where: {userId: pending.id}}), 0);
    assert.equal((await grantSchoolAdmin(member, b.id, {email: invitedEmails[0]})).created, false);
    await assert.rejects(grantSchoolAdmin(member, b.id, {email: invitedEmails[0], role: 'OWNER'}), /./);
    await grantSchoolAdmin(creator, a.id, {email: global + '@example.test'});
    assert.equal((await db.user.findUniqueOrThrow({where: {id: global}})).role, 'ADMIN', 'a school grant never overwrites a platform role');
    assert.equal((await schoolPermissions(global, b.id)).global, true);
    await grantSchoolAdmin(global, a.id, {email: member + '@example.test', revoke: true});
    assert.deepEqual(await managedSchoolIds(member), [b.id]);
    await grantSchoolAdmin(moderator, b.id, {email: member + '@example.test', revoke: true});
    assert.deepEqual(await managedSchoolIds(member), []);
    assert.equal((await adminAccessIdentity(member))?.hasSchoolAccess, false);
    await assert.rejects(grantSchoolAdmin(global, a.id, {email: creator + '@example.test', revoke: true}), /LAST_SCHOOL_MANAGER/);
    await grantSchoolAdmin(creator, a.id, {email: second + '@example.test', role: 'MANAGER'});
    const removals = await Promise.allSettled([creator, second].map(id => grantSchoolAdmin(global, a.id, {email: id + '@example.test', revoke: true})));
    assert.equal(removals.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(removals.filter(result => result.status === 'rejected' && /LAST_SCHOOL_MANAGER/.test(String(result.reason))).length, 1);
    assert.equal(await db.schoolAdmin.count({where: {schoolProfileId: a.id, canManageAdmins: true}}), 1);
    await db.user.update({where: {id: moderator}, data: {bannedAt: new Date()}});
    await assert.rejects(grantSchoolAdmin(moderator, b.id, {email: invitedEmails[1]}), /FORBIDDEN/);
    assert.deepEqual(await managedSchoolIds(moderator), []);
    assert.equal(await db.user.count({where: {email: invitedEmails[1]}}), 0);
  } finally {
    await db.profile.deleteMany({where: {id: {in: schoolIds}}});
    await db.auditLog.deleteMany({where: {actorUserId: {in: ids}}});
    await db.user.deleteMany({where: {OR: [{id: {in: ids}}, {email: {in: invitedEmails}}]}});
    await db.$disconnect();
  }
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
    assert.equal((await db.user.findUniqueOrThrow({where: {id: claimant}})).role, 'USER');
    assert.equal((await db.schoolAdmin.findUniqueOrThrow({where: {userId_schoolProfileId: {userId: claimant, schoolProfileId: b.id}}})).canManageAdmins, true);
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
