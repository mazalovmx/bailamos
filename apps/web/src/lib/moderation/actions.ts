// Moderation actions shared by the web app and the admin panel: every state change and its AuditLog row share one transaction.
// Canonical source. apps/web/src/lib/moderation/actions.ts and apps/admin/src/lib/moderation.ts are verbatim copies
// (only the import line differs) until @dance/db exports "./moderation"; apps/web/tests/moderation.test.ts fails when they drift.
import {db, Prisma} from '@dance/db';
export const targetTypes = ['EVENT', 'PROFILE', 'POST', 'MEDIA', 'MESSAGE', 'VENUE'] as const;
export type TargetType = typeof targetTypes[number];
export const targetModels: Record<TargetType, string> = {EVENT: 'Event', PROFILE: 'Profile', POST: 'Post', MEDIA: 'MediaItem', MESSAGE: 'Message', VENUE: 'Venue'};
export const resolutionActions = ['HIDE', 'DELETE', 'NONE', 'DISMISS'] as const;
export type Decision = {action: typeof resolutionActions[number]; banAuthor?: boolean; reason: string; comment?: string | null};
export class ModerationError extends Error {
  constructor(public code: string, public status = 400) {super(code);}
}
type Tx = Prisma.TransactionClient;
const run = <T>(tx: Tx | undefined, work: (tx: Tx) => Promise<T>) => tx ? work(tx) : db.$transaction(work);
const cut = (value: string | null | undefined, length = 500) => value ? value.slice(0, length) : null;
export function audit(tx: Tx, actorUserId: string | null, action: string, targetType: string, targetId: string | null, data?: Prisma.InputJsonObject) {
  return tx.auditLog.create({data: {actorUserId, action, targetType, targetId, data}});
}
export type TargetInfo = {type: TargetType; id: string; title: string; text: string | null; hiddenAt: Date | null;
  authorUserId: string | null; authorProfileId: string | null; mediaKey: string | null; path: string | null};
// What a moderator needs to judge a reported object, and who is responsible for it. Null when the object no longer exists.
export async function targetInfo(type: TargetType, id: string, tx: Tx = db): Promise<TargetInfo | null> {
  const base = {type, id, text: null, authorUserId: null, authorProfileId: null, mediaKey: null, path: null};
  const author = (profile?: {id: string; userId: string | null} | null) => ({authorUserId: profile?.userId ?? null, authorProfileId: profile?.id ?? null});
  switch (type) {
    case 'EVENT': {
      const row = await tx.event.findUnique({where: {id}, select: {title: true, description: true, slug: true, hiddenAt: true,
        members: {where: {role: 'OWNER'}, take: 1, select: {profile: {select: {id: true, userId: true}}}}}});
      return row && {...base, title: row.title, text: cut(row.description), hiddenAt: row.hiddenAt, path: '/events/' + row.slug, ...author(row.members[0]?.profile)};
    }
    case 'PROFILE': {
      const row = await tx.profile.findUnique({where: {id}, select: {id: true, userId: true, name: true, handle: true, bio: true, avatarKey: true, hiddenAt: true}});
      return row && {...base, title: row.name + ' (@' + row.handle + ')', text: cut(row.bio), hiddenAt: row.hiddenAt, mediaKey: row.avatarKey, path: '/people/' + row.handle, ...author(row)};
    }
    case 'POST': {
      const row = await tx.post.findUnique({where: {id}, select: {title: true, excerpt: true, hiddenAt: true, profile: {select: {id: true, userId: true}}}});
      return row && {...base, title: row.title, text: cut(row.excerpt), hiddenAt: row.hiddenAt, ...author(row.profile)};
    }
    case 'MEDIA': {
      const row = await tx.mediaItem.findUnique({where: {id}, select: {kind: true, alt: true, storageKey: true, sourceUrl: true, hiddenAt: true, uploader: {select: {id: true, userId: true}}}});
      return row && {...base, title: row.kind, text: cut(row.alt ?? row.sourceUrl), hiddenAt: row.hiddenAt, mediaKey: row.storageKey, ...author(row.uploader)};
    }
    case 'MESSAGE': {
      const row = await tx.message.findUnique({where: {id}, select: {body: true, hiddenAt: true, sender: {select: {id: true, userId: true, name: true}}}});
      return row && {...base, title: row.sender.name, text: cut(row.body), hiddenAt: row.hiddenAt, ...author(row.sender)};
    }
    case 'VENUE': {
      const row = await tx.venue.findUnique({where: {id}, select: {name: true, address: true, hiddenAt: true}});
      return row && {...base, title: row.name, text: row.address, hiddenAt: row.hiddenAt};
    }
  }
}
async function setHidden(tx: Tx, type: TargetType, id: string, hiddenAt: Date | null) {
  const args = {where: {id}, data: {hiddenAt}};
  const result = type === 'EVENT' ? await tx.event.updateMany(args) : type === 'PROFILE' ? await tx.profile.updateMany(args)
    : type === 'POST' ? await tx.post.updateMany(args) : type === 'MEDIA' ? await tx.mediaItem.updateMany(args)
    : type === 'MESSAGE' ? await tx.message.updateMany(args) : await tx.venue.updateMany(args);
  if (!result.count) throw new ModerationError('NOT_FOUND', 404);
}
export function hideTarget(type: TargetType, id: string, actorUserId: string, reason: string, outer?: Tx) {
  return run(outer, async tx => {
    await setHidden(tx, type, id, new Date());
    await audit(tx, actorUserId, 'TARGET_HIDE', targetModels[type], id, {reason});
  });
}
export function unhideTarget(type: TargetType, id: string, actorUserId: string, reason: string, outer?: Tx) {
  return run(outer, async tx => {
    await setHidden(tx, type, id, null);
    await audit(tx, actorUserId, 'TARGET_UNHIDE', targetModels[type], id, {reason});
  });
}
// Deletion is irreversible, so the audit row keeps a short snapshot of what was removed. Stored media objects are not purged here.
export function deleteTarget(type: TargetType, id: string, actorUserId: string, reason: string, outer?: Tx) {
  return run(outer, async tx => {
    const info = await targetInfo(type, id, tx);
    if (!info) throw new ModerationError('NOT_FOUND', 404);
    const where = {where: {id}};
    if (type === 'EVENT') await tx.event.delete(where);
    else if (type === 'PROFILE') await tx.profile.delete(where);
    else if (type === 'POST') await tx.post.delete(where);
    else if (type === 'MEDIA') await tx.mediaItem.delete(where);
    else if (type === 'MESSAGE') await tx.message.delete(where);
    else await tx.venue.delete(where);
    await audit(tx, actorUserId, 'TARGET_DELETE', targetModels[type], id,
      {reason, title: info.title, text: info.text, authorUserId: info.authorUserId, mediaKey: info.mediaKey});
  });
}
// Removing every session ends access at once: the web actor() also rejects banned users, so publications and chat stop immediately.
export function banUser(userId: string, reason: string, actorUserId: string, outer?: Tx) {
  return run(outer, async tx => {
    if (userId === actorUserId) throw new ModerationError('SELF_ACTION');
    const user = await tx.user.findUnique({where: {id: userId}, select: {role: true}});
    if (!user) throw new ModerationError('NOT_FOUND', 404);
    const actor = await tx.user.findUnique({where: {id: actorUserId}, select: {role: true}});
    // Staff accounts can only be banned by an administrator.
    if (user.role === 'OWNER' || (user.role === 'ADMIN' && actor?.role !== 'OWNER') || (user.role !== 'USER' && !['OWNER','ADMIN'].includes(actor?.role ?? ''))) throw new ModerationError('FORBIDDEN', 403);
    await tx.user.update({where: {id: userId}, data: {bannedAt: new Date(), banReason: reason}});
    const sessions = await tx.session.deleteMany({where: {userId}});
    await audit(tx, actorUserId, 'USER_BAN', 'User', userId, {reason, sessionsRevoked: sessions.count});
  });
}
export function unbanUser(userId: string, actorUserId: string, reason?: string | null, outer?: Tx) {
  return run(outer, async tx => {
    const result = await tx.user.updateMany({where: {id: userId}, data: {bannedAt: null, banReason: null}});
    if (!result.count) throw new ModerationError('NOT_FOUND', 404);
    await audit(tx, actorUserId, 'USER_UNBAN', 'User', userId, {reason: reason ?? null});
  });
}
export function setUserRole(userId: string, role: 'USER' | 'MODERATOR' | 'ADMIN' | 'OWNER' | 'SCHOOL_ADMIN', actorUserId: string, outer?: Tx) {
  return run(outer, async tx => {
    // Nobody changes their own role, so the last administrator cannot lock the panel by accident.
    if (userId === actorUserId) throw new ModerationError('SELF_ACTION');
    const actor = await tx.user.findUnique({where: {id: actorUserId}, select: {role: true}});
    if (!['OWNER','ADMIN'].includes(actor?.role ?? '') || role === 'OWNER' || (role === 'ADMIN' && actor?.role !== 'OWNER')) throw new ModerationError('FORBIDDEN', 403);
    const user = await tx.user.findUnique({where: {id: userId}, select: {role: true}});
    if (!user) throw new ModerationError('NOT_FOUND', 404);
    if (user.role === 'OWNER' || (user.role === 'ADMIN' && actor?.role !== 'OWNER')) throw new ModerationError('FORBIDDEN', 403);
    await tx.user.update({where: {id: userId}, data: {role}});
    await tx.session.deleteMany({where: {userId}});
    await audit(tx, actorUserId, 'USER_ROLE', 'User', userId, {from: user.role, to: role});
  });
}
// One decision answers every open report on the same object: the content action, the optional ban, the reports,
// the audit rows and the reporters' notifications are committed together or not at all.
export function resolveTarget(type: TargetType, id: string, decision: Decision, actorUserId: string) {
  return db.$transaction(async tx => {
    if (!decision.reason.trim() || (decision.action === 'DISMISS' && decision.banAuthor)) throw new ModerationError('INVALID_INPUT');
    const open = await tx.report.findMany({where: {targetType: type, targetId: id, status: 'OPEN'}, select: {id: true, reporterUserId: true}});
    if (!open.length) throw new ModerationError('ALREADY_DECIDED', 409);
    const info = await targetInfo(type, id, tx);
    const comment = decision.comment?.trim() || null;
    const resolution = decision.reason + (comment ? ': ' + comment : '');
    const status = decision.action === 'DISMISS' ? 'DISMISSED' as const : 'RESOLVED' as const;
    if (decision.banAuthor) {
      if (!info?.authorUserId) throw new ModerationError('NO_AUTHOR');
      await banUser(info.authorUserId, resolution, actorUserId, tx);
    }
    if (info && decision.action === 'HIDE') await hideTarget(type, id, actorUserId, resolution, tx);
    if (info && decision.action === 'DELETE') await deleteTarget(type, id, actorUserId, resolution, tx);
    await tx.report.updateMany({where: {id: {in: open.map(report => report.id)}},
      data: {status, resolution, resolvedByUserId: actorUserId, resolvedAt: new Date()}});
    const data = {targetType: type, targetId: id, action: decision.action, banAuthor: !!decision.banAuthor, reason: decision.reason, comment};
    await tx.auditLog.createMany({data: open.map(report =>
      ({actorUserId, action: status === 'DISMISSED' ? 'REPORT_DISMISS' : 'REPORT_RESOLVE', targetType: 'Report', targetId: report.id, data}))});
    const reporters = [...new Set(open.map(report => report.reporterUserId).filter((value): value is string => !!value))];
    if (reporters.length) await tx.notification.createMany({data: reporters.map(userId =>
      ({userId, type: 'MODERATION', data: {status, targetType: type, targetId: id, action: decision.action, title: info?.title ?? null}}))});
    return {status, reports: open.length, banned: !!decision.banAuthor, authorUserId: info?.authorUserId ?? null};
  });
}
export async function resolveReport(reportId: string, decision: Decision, actorUserId: string) {
  const report = await db.report.findUnique({where: {id: reportId}, select: {targetType: true, targetId: true, status: true}});
  if (!report) throw new ModerationError('NOT_FOUND', 404);
  if (report.status !== 'OPEN') throw new ModerationError('ALREADY_DECIDED', 409);
  return resolveTarget(report.targetType, report.targetId, decision, actorUserId);
}
// Approval hands a stub profile to the claimant. Profile.userId is unique, so a claimant who already owns a profile is refused.
export async function decideClaim(claimId: string, approve: boolean, actorUserId: string, reason?: string | null) {
  const note = reason?.trim() || null;
  if (!approve && !note) throw new ModerationError('REASON_REQUIRED');
  try {
    return await db.$transaction(async tx => {
      const claim = await tx.profileClaim.findUnique({where: {id: claimId},
        include: {profile: {select: {id: true, userId: true, handle: true, name: true, type: true}}, user: {select: {bannedAt: true, role: true}}}});
      if (!claim) throw new ModerationError('NOT_FOUND', 404);
      if (claim.status !== 'PENDING') throw new ModerationError('ALREADY_DECIDED', 409);
      const decided = {decidedByUserId: actorUserId, decidedAt: new Date()};
      const message = {claimId, profileId: claim.profileId, handle: claim.profile.handle, name: claim.profile.name};
      const url = '/people/' + claim.profile.handle;
      let rejected: {id: string; userId: string}[] = [];
      if (approve) {
        if (claim.user.bannedAt) throw new ModerationError('CLAIMANT_BANNED', 409);
        if (claim.profile.userId && claim.profile.userId !== claim.userId) throw new ModerationError('PROFILE_ALREADY_OWNED', 409);
        const own = await tx.profile.findUnique({where: {userId: claim.userId}, select: {id: true}});
        if (own && own.id !== claim.profileId) throw new ModerationError('CLAIMANT_HAS_PROFILE', 409);
        await tx.profile.update({where: {id: claim.profileId}, data: {userId: claim.userId}});
        // The verified owner of a school also gets its cabinet in the admin panel; staff roles are left as they are.
        if (claim.profile.type === 'SCHOOL') {
          const grant = {userId: claim.userId, schoolProfileId: claim.profileId};
          await tx.schoolAdmin.upsert({where: {userId_schoolProfileId: grant}, create: grant, update: {}});
          if (claim.user.role === 'USER') await tx.user.update({where: {id: claim.userId}, data: {role: 'SCHOOL_ADMIN'}});
        }
        await tx.profileClaim.update({where: {id: claimId}, data: {status: 'APPROVED', ...decided}});
        rejected = await tx.profileClaim.findMany({where: {profileId: claim.profileId, status: 'PENDING', id: {not: claimId}}, select: {id: true, userId: true}});
        if (rejected.length) {
          await tx.profileClaim.updateMany({where: {id: {in: rejected.map(other => other.id)}}, data: {status: 'REJECTED', ...decided}});
          await tx.notification.createMany({data: rejected.map(other => ({userId: other.userId, type: 'CLAIM_DECIDED', url,
            data: {...message, claimId: other.id, status: 'REJECTED', reason: 'OTHER_CLAIM_APPROVED'}}))});
        }
      } else await tx.profileClaim.update({where: {id: claimId}, data: {status: 'REJECTED', ...decided}});
      const status = approve ? 'APPROVED' as const : 'REJECTED' as const;
      await audit(tx, actorUserId, approve ? 'CLAIM_APPROVE' : 'CLAIM_REJECT', 'ProfileClaim', claimId,
        {profileId: claim.profileId, userId: claim.userId, reason: note, rejectedClaimIds: rejected.map(other => other.id)});
      await tx.notification.create({data: {userId: claim.userId, type: 'CLAIM_DECIDED', url, data: {...message, status, reason: note}}});
      return {status, profileId: claim.profileId, userId: claim.userId};
    });
  } catch (error) {
    // Two approvals racing for the same claimant end on the unique Profile.userId index.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ModerationError('CLAIMANT_HAS_PROFILE', 409);
    throw error;
  }
}
