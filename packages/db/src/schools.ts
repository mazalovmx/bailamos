import {randomUUID} from 'node:crypto';
import {db} from './index';
import type {Prisma} from '@prisma/client';

type Tx = Prisma.TransactionClient;
export class SchoolAccessError extends Error {
  constructor(public code: string, public status = 403) {super(code);}
}
export const globalSchoolAccess = (role: string) => role === 'OWNER' || role === 'ADMIN';

// School membership is independent of the platform role. A moderator or global administrator can
// also manage a school, and one person can have different permissions in several schools.
export async function adminAccessIdentity(userId: string, tx: Tx = db) {
  const user = await tx.user.findUnique({where: {id: userId}, select: {
    id: true, name: true, email: true, role: true, bannedAt: true, emailVerified: true,
    profile: {select: {type: true}},
    schoolAdminships: {where: {school: {type: 'SCHOOL'}}, select: {schoolProfileId: true}, take: 1}
  }});
  if (!user) return null;
  const {profile, schoolAdminships, ...identity} = user;
  return {...identity, hasSchoolAccess: profile?.type === 'SCHOOL' || schoolAdminships.length > 0};
}

export async function schoolPermissions(userId: string, schoolId: string, tx: Tx = db) {
  const user = await tx.user.findUnique({where: {id: userId}, select: {role: true, emailVerified: true, bannedAt: true}});
  if (!user || user.bannedAt || !user.emailVerified) throw new SchoolAccessError('FORBIDDEN');
  const school = await tx.profile.findFirst({where: {id: schoolId, type: 'SCHOOL'}});
  if (!school) throw new SchoolAccessError('NOT_FOUND', 404);
  const global = globalSchoolAccess(user.role);
  const member = await tx.schoolAdmin.findUnique({where: {userId_schoolProfileId: {userId, schoolProfileId: schoolId}}});
  if (!global && school.userId !== userId && !member) throw new SchoolAccessError('FORBIDDEN');
  return {school, global, canManageAdmins: global || school.userId === userId || !!member?.canManageAdmins};
}

export async function schoolIdsFor(userId: string, tx: Tx = db) {
  const user = await tx.user.findUnique({where: {id: userId}, select: {role: true, emailVerified: true, bannedAt: true}});
  if (!user || user.bannedAt || !user.emailVerified) return [];
  const schools = await tx.profile.findMany({where: {type: 'SCHOOL', ...(!globalSchoolAccess(user.role) ? {
    OR: [{userId}, {schoolAdmins: {some: {userId}}}]
  } : {})}, select: {id: true}, orderBy: {id: 'asc'}});
  return schools.map(school => school.id);
}

// Both the site and admin panel use this transaction, including invitation of an email that has
// never registered. Google must still verify the email before it can receive an admin session.
export async function assignSchoolMember(actorId: string, schoolId: string,
  input: {email: string; revoke: boolean; canManageAdmins: boolean}) {
  const email = input.email.trim().toLowerCase();
  return db.$transaction(async tx => {
    // Every team mutation locks the school, so membership changes and last-manager checks are atomic.
    await tx.$queryRaw`SELECT id FROM "Profile" WHERE id = ${schoolId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
    // Consistent user lock order also prevents two managers inviting each other from deadlocking.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} OR lower(email) = ${email} ORDER BY id FOR UPDATE`;
    const access = await schoolPermissions(actorId, schoolId, tx);
    if (!access.canManageAdmins) throw new SchoolAccessError('FORBIDDEN');
    const matches = await tx.user.findMany({where: {email: {equals: email, mode: 'insensitive'}}, take: 2,
      select: {id: true, email: true, bannedAt: true}});
    if (matches.length > 1) throw new SchoolAccessError('EMAIL_CONFLICT', 409);
    let target = matches[0];
    if (target?.bannedAt) throw new SchoolAccessError('USER_BANNED', 409);
    if (target?.id === actorId || target?.id === access.school.userId) throw new SchoolAccessError('FORBIDDEN');
    if (!target && input.revoke) throw new SchoolAccessError('NOT_FOUND', 404);
    const created = !target;
    if (!target) {
      target = await tx.user.create({data: {id: randomUUID(), name: email, email, emailVerified: false, role: 'USER'},
        select: {id: true, email: true, bannedAt: true}});
    } else if (target.email !== email) {
      await tx.user.update({where: {id: target.id}, data: {email}});
      await tx.auditLog.create({data: {actorUserId: actorId, action: 'USER_EMAIL_NORMALIZE', targetType: 'User', targetId: target.id,
        data: {from: target.email, to: email}}});
    }
    const key = {userId: target.id, schoolProfileId: schoolId};
    const previous = await tx.schoolAdmin.findUnique({where: {userId_schoolProfileId: key}});
    if (previous?.canManageAdmins && (input.revoke || !input.canManageAdmins) && !access.school.userId) {
      const otherManagers = await tx.schoolAdmin.count({where: {schoolProfileId: schoolId, userId: {not: target.id},
        canManageAdmins: true, user: {bannedAt: null}}});
      if (!otherManagers) throw new SchoolAccessError('LAST_SCHOOL_MANAGER', 409);
    }
    if (input.revoke) await tx.schoolAdmin.deleteMany({where: key});
    else await tx.schoolAdmin.upsert({where: {userId_schoolProfileId: key}, create: {...key, canManageAdmins: input.canManageAdmins},
      update: {canManageAdmins: input.canManageAdmins}});
    if ((input.revoke && previous) || (!input.revoke && (!previous || previous.canManageAdmins !== input.canManageAdmins))) {
      await tx.auditLog.create({data: {actorUserId: actorId, action: input.revoke ? 'SCHOOL_ADMIN_REVOKE' : 'SCHOOL_ADMIN_GRANT',
        targetType: 'School', targetId: schoolId, data: {userId: target.id, email, schoolProfileId: schoolId,
          canManageAdmins: input.canManageAdmins, created}}});
    }
    // Existing web sessions stay usable. All school and panel guards read the current memberships.
    return {ok: true, id: target.id, email, created, schoolId, scope: 'school' as const,
      role: input.canManageAdmins ? 'MANAGER' as const : 'ADMIN' as const};
  });
}
