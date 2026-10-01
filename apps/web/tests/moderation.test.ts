// Runs against the local database with temporary rows that are removed afterwards:
// pnpm --filter @dance/web exec tsx --test tests/moderation.test.ts
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {config} from 'dotenv';
import {db, type UserRole} from '@dance/db';
import {banUser, createReport, decideClaim, hideTarget, ModerationError, reportsPerHour, resolveReport, resolveTarget, setUserRole,
  unbanUser, unhideTarget, deleteTarget} from '../src/lib/moderation';
config({path: '../../.env', quiet: true});
const tag = 'modtest-' + randomUUID().slice(0, 8);
const userIds: string[] = [], profileIds: string[] = [];
let sequence = 0;
async function user(role: UserRole = 'USER') {
  const id = tag + '-u' + userIds.length;
  userIds.push(id);
  await db.user.create({data: {id, name: 'Moderation test', email: id + '@example.test', emailVerified: true, role}});
  return id;
}
async function profile(userId?: string) {
  const handle = tag + '-p' + sequence++;
  const row = await db.profile.create({data: {type: userId ? 'DANCER' : 'SCHOOL', handle, name: 'Moderation test ' + handle, userId}});
  profileIds.push(row.id);
  return row.id;
}
const session = (userId: string) => db.session.create({data: {id: randomUUID(), token: randomUUID(), userId, expiresAt: new Date(Date.now() + 3600_000)}});
const code = (expected: string) => (error: unknown) => error instanceof ModerationError && error.code === expected;
const actions = async (actorUserId: string) => (await db.auditLog.findMany({where: {actorUserId}, orderBy: {createdAt: 'asc'}})).map(row => row.action);
// The exact condition the web actor() applies before any mutation (publications, RSVP, chat).
const actorRejects = async (userId: string) => {
  const account = await db.user.findUnique({where: {id: userId}, select: {bannedAt: true}});
  return !account || !!account.bannedAt;
};
after(async () => {
  await db.report.deleteMany({where: {OR: [{reporterUserId: {in: userIds}}, {targetId: {in: profileIds}}]}});
  await db.auditLog.deleteMany({where: {actorUserId: {in: userIds}}});
  await db.profile.deleteMany({where: {id: {in: profileIds}}});
  await db.user.deleteMany({where: {id: {in: userIds}}});
  await db.$disconnect();
});
test('the web and admin copies of the moderation actions match the canonical file in packages/db', async () => {
  const read = async (path: string) => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n').replace(/^import \{db, Prisma\} from .*$/m, '');
  const canonical = await read('../../../packages/db/src/moderation.ts');
  assert.ok(canonical.includes('export function banUser'));
  assert.equal(await read('../src/lib/moderation/actions.ts'), canonical);
  assert.equal(await read('../../admin/src/lib/moderation.ts'), canonical);
});
test('a report is idempotent per user and object, checks the target and is rate-limited', async () => {
  const reporter = await user(), target = await profile();
  const first = await createReport({id: reporter}, {targetType: 'PROFILE', targetId: target, reason: 'SPAM', comment: 'first'});
  assert.equal(first.created, true);
  const again = await Promise.all([1, 2, 3, 4].map(() => createReport({id: reporter}, {targetType: 'PROFILE', targetId: target, reason: 'FAKE'})));
  for (const result of again) assert.deepEqual(result, {id: first.id, created: false});
  assert.equal(await db.report.count({where: {reporterUserId: reporter, targetId: target}}), 1);
  await assert.rejects(createReport({id: reporter}, {targetType: 'PROFILE', targetId: 'missing-' + tag, reason: 'SPAM'}), code('NOT_FOUND'));
  await assert.rejects(createReport({id: reporter}, {targetType: 'MESSAGE', targetId: 'missing-' + tag, reason: 'SPAM'}), code('NOT_FOUND'));
  const own = await profile(reporter);
  await assert.rejects(createReport({id: reporter}, {targetType: 'PROFILE', targetId: own, reason: 'SPAM'}), code('OWN_CONTENT'));
  // Concurrent reports on different objects must not slip past the hourly limit.
  const targets = await Promise.all(Array.from({length: reportsPerHour + 2}, () => profile()));
  const results = await Promise.allSettled(targets.map(id => createReport({id: reporter}, {targetType: 'PROFILE', targetId: id, reason: 'OTHER'})));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, reportsPerHour - 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => code('RATE_LIMITED')((result as PromiseRejectedResult).reason)));
  assert.equal(await db.report.count({where: {reporterUserId: reporter}}), reportsPerHour);
  // After the first report is closed, the same user may report the same object again (subject to the limit).
  await db.report.updateMany({where: {reporterUserId: reporter}, data: {createdAt: new Date(Date.now() - 2 * 3600_000), status: 'DISMISSED'}});
  assert.equal((await createReport({id: reporter}, {targetType: 'PROFILE', targetId: target, reason: 'SPAM'})).created, true);
});
test('a ban revokes every session, blocks the actor() check and is audited; staff are protected', async () => {
  const moderator = await user('MODERATOR'), admin = await user('ADMIN'), member = await user(), otherModerator = await user('MODERATOR');
  await Promise.all([session(member), session(member), session(moderator)]);
  assert.equal(await actorRejects(member), false);
  await banUser(member, 'SPAM: test', moderator);
  assert.equal(await db.session.count({where: {userId: member}}), 0);
  assert.equal(await db.session.count({where: {userId: moderator}}), 1);
  assert.equal(await actorRejects(member), true);
  const banned = await db.user.findUniqueOrThrow({where: {id: member}});
  assert.ok(banned.bannedAt);
  assert.equal(banned.banReason, 'SPAM: test');
  const row = await db.auditLog.findFirstOrThrow({where: {actorUserId: moderator, action: 'USER_BAN'}});
  assert.equal(row.targetType, 'User');
  assert.equal(row.targetId, member);
  assert.deepEqual(row.data, {reason: 'SPAM: test', sessionsRevoked: 2});
  await unbanUser(member, moderator, 'appeal');
  assert.equal(await actorRejects(member), false);
  assert.equal((await db.user.findUniqueOrThrow({where: {id: member}})).banReason, null);
  assert.deepEqual(await actions(moderator), ['USER_BAN', 'USER_UNBAN']);
  await assert.rejects(banUser(moderator, 'x', moderator), code('SELF_ACTION'));
  await assert.rejects(banUser(otherModerator, 'x', moderator), code('FORBIDDEN'));
  await assert.rejects(banUser('missing-' + tag, 'x', moderator), code('NOT_FOUND'));
  assert.equal((await db.user.findUniqueOrThrow({where: {id: otherModerator}})).bannedAt, null);
  await banUser(otherModerator, 'abuse', admin);
  assert.ok((await db.user.findUniqueOrThrow({where: {id: otherModerator}})).bannedAt);
  await assert.rejects(setUserRole(member, 'MODERATOR', moderator), code('FORBIDDEN'));
  await assert.rejects(setUserRole(admin, 'USER', admin), code('SELF_ACTION'));
  await setUserRole(member, 'MODERATOR', admin);
  assert.equal((await db.user.findUniqueOrThrow({where: {id: member}})).role, 'MODERATOR');
  assert.deepEqual((await db.auditLog.findFirstOrThrow({where: {actorUserId: admin, action: 'USER_ROLE'}})).data, {from: 'USER', to: 'MODERATOR'});
});
test('hide, unhide and delete write audit rows and fail without side effects on a missing object', async () => {
  const moderator = await user('MODERATOR'), target = await profile();
  await hideTarget('PROFILE', target, moderator, 'SPAM');
  assert.ok((await db.profile.findUniqueOrThrow({where: {id: target}})).hiddenAt);
  await unhideTarget('PROFILE', target, moderator, 'mistake');
  assert.equal((await db.profile.findUniqueOrThrow({where: {id: target}})).hiddenAt, null);
  await assert.rejects(hideTarget('PROFILE', 'missing-' + tag, moderator, 'SPAM'), code('NOT_FOUND'));
  await assert.rejects(hideTarget('EVENT', 'missing-' + tag, moderator, 'SPAM'), code('NOT_FOUND'));
  await deleteTarget('PROFILE', target, moderator, 'FAKE');
  assert.equal(await db.profile.count({where: {id: target}}), 0);
  const rows = await db.auditLog.findMany({where: {actorUserId: moderator}, orderBy: {createdAt: 'asc'}});
  assert.deepEqual(rows.map(row => [row.action, row.targetType, row.targetId]),
    [['TARGET_HIDE', 'Profile', target], ['TARGET_UNHIDE', 'Profile', target], ['TARGET_DELETE', 'Profile', target]]);
  assert.deepEqual(rows[0].data, {reason: 'SPAM'});
  assert.equal((rows[2].data as {title: string}).title.startsWith('Moderation test'), true);
});
test('resolving a report hides the content, bans the author, closes sibling reports and notifies reporters atomically', async () => {
  const moderator = await user('MODERATOR'), author = await user(), reporters = [await user(), await user()];
  const target = await profile(author);
  await session(author);
  const reports = [];
  for (const reporter of reporters) reports.push(await createReport({id: reporter}, {targetType: 'PROFILE', targetId: target, reason: 'HARASSMENT'}));
  await assert.rejects(resolveTarget('PROFILE', target, {action: 'DISMISS', banAuthor: true, reason: 'SPAM'}, moderator), code('INVALID_INPUT'));
  const result = await resolveReport(reports[0].id, {action: 'HIDE', banAuthor: true, reason: 'HARASSMENT', comment: 'insults'}, moderator);
  assert.deepEqual(result, {status: 'RESOLVED', reports: 2, banned: true, authorUserId: author});
  const closed = await db.report.findMany({where: {targetId: target}});
  assert.ok(closed.every(report => report.status === 'RESOLVED' && report.resolution === 'HARASSMENT: insults' && report.resolvedByUserId === moderator && report.resolvedAt));
  assert.ok((await db.profile.findUniqueOrThrow({where: {id: target}})).hiddenAt);
  assert.equal(await actorRejects(author), true);
  assert.equal(await db.session.count({where: {userId: author}}), 0);
  assert.deepEqual((await actions(moderator)).sort(), ['REPORT_RESOLVE', 'REPORT_RESOLVE', 'TARGET_HIDE', 'USER_BAN']);
  for (const reporter of reporters) {
    const notes = await db.notification.findMany({where: {userId: reporter}});
    assert.equal(notes.length, 1);
    assert.equal(notes[0].type, 'MODERATION');
    assert.equal((notes[0].data as {status: string}).status, 'RESOLVED');
  }
  await assert.rejects(resolveReport(reports[1].id, {action: 'DISMISS', reason: 'NO_VIOLATION'}, moderator), code('ALREADY_DECIDED'));
  // A moderator cannot ban a staff author; the whole decision rolls back.
  const staffAuthor = await user('ADMIN'), staffProfile = await profile(staffAuthor);
  const report = await createReport({id: reporters[0]}, {targetType: 'PROFILE', targetId: staffProfile, reason: 'SPAM'});
  await assert.rejects(resolveReport(report.id, {action: 'HIDE', banAuthor: true, reason: 'SPAM'}, moderator), code('FORBIDDEN'));
  assert.equal((await db.report.findUniqueOrThrow({where: {id: report.id}})).status, 'OPEN');
  assert.equal((await db.profile.findUniqueOrThrow({where: {id: staffProfile}})).hiddenAt, null);
  assert.equal((await db.user.findUniqueOrThrow({where: {id: staffAuthor}})).bannedAt, null);
  assert.deepEqual(await resolveReport(report.id, {action: 'DISMISS', reason: 'NO_VIOLATION'}, moderator),
    {status: 'DISMISSED', reports: 1, banned: false, authorUserId: staffAuthor});
  assert.equal((await db.auditLog.findFirstOrThrow({where: {actorUserId: moderator, action: 'REPORT_DISMISS'}})).targetId, report.id);
});
test('claim approval transfers a stub profile, rejects competing claims and refuses a claimant who already owns a profile', async () => {
  const moderator = await user('MODERATOR'), winner = await user(), loser = await user(), owner = await user();
  const stub = await profile(), other = await profile();
  await profile(owner);
  const claim = (profileId: string, userId: string) => db.profileClaim.create({data: {profileId, userId, message: 'This is my school profile'}});
  const [won, lost, blocked, second] = [await claim(stub, winner), await claim(stub, loser), await claim(other, owner), await claim(other, loser)];
  await assert.rejects(decideClaim(blocked.id, true, moderator), code('CLAIMANT_HAS_PROFILE'));
  assert.equal((await db.profileClaim.findUniqueOrThrow({where: {id: blocked.id}})).status, 'PENDING');
  assert.equal((await db.profile.findUniqueOrThrow({where: {id: other}})).userId, null);
  await assert.rejects(decideClaim(blocked.id, false, moderator, '  '), code('REASON_REQUIRED'));
  assert.deepEqual(await decideClaim(won.id, true, moderator), {status: 'APPROVED', profileId: stub, userId: winner});
  assert.equal((await db.profile.findUniqueOrThrow({where: {id: stub}})).userId, winner);
  const [approved, rejected] = await Promise.all([won.id, lost.id].map(id => db.profileClaim.findUniqueOrThrow({where: {id}})));
  assert.deepEqual([approved.status, approved.decidedByUserId, rejected.status, rejected.decidedByUserId], ['APPROVED', moderator, 'REJECTED', moderator]);
  const [winNote] = await db.notification.findMany({where: {userId: winner}}), [loseNote] = await db.notification.findMany({where: {userId: loser}});
  assert.equal(winNote.type, 'CLAIM_DECIDED');
  assert.equal((winNote.data as {status: string}).status, 'APPROVED');
  assert.deepEqual([(loseNote.data as {status: string}).status, (loseNote.data as {reason: string}).reason], ['REJECTED', 'OTHER_CLAIM_APPROVED']);
  await assert.rejects(decideClaim(won.id, false, moderator, 'late'), code('ALREADY_DECIDED'));
  await assert.rejects(decideClaim('missing-' + tag, true, moderator), code('NOT_FOUND'));
  // The profile was taken meanwhile by someone else: approving another claim on it is refused.
  await db.profile.update({where: {id: other}, data: {userId: moderator}});
  await assert.rejects(decideClaim(second.id, true, moderator), code('PROFILE_ALREADY_OWNED'));
  await db.profile.update({where: {id: other}, data: {userId: null}});
  assert.deepEqual(await decideClaim(blocked.id, false, moderator, 'No proof of ownership'), {status: 'REJECTED', profileId: other, userId: owner});
  const audit = await db.auditLog.findMany({where: {actorUserId: moderator}, orderBy: {createdAt: 'asc'}});
  assert.deepEqual(audit.map(row => [row.action, row.targetId]), [['CLAIM_APPROVE', won.id], ['CLAIM_REJECT', blocked.id]]);
  assert.deepEqual((audit[0].data as {rejectedClaimIds: string[]}).rejectedClaimIds, [lost.id]);
  assert.equal((audit[1].data as {reason: string}).reason, 'No proof of ownership');
});
