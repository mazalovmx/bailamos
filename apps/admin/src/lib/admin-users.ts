import {randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {z} from 'zod';
import {mayEnterAdmin} from './auth-policy';
import {HttpError} from './errors';
import {audit, setUserRole} from './moderation';

export const addAdminSchema = z.strictObject({email: z.string().trim().toLowerCase().pipe(z.email().max(254)), role: z.enum(['ADMIN','MODERATOR']).default('ADMIN')});

// Provision only the exact email chosen by an owner. Google must still prove ownership of that email;
// this creates neither credentials nor a verified email nor a session.
export async function addAdminByEmail(actorId: string, input: unknown) {
  const {email, role} = addAdminSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} OR lower(email) = ${email} ORDER BY id FOR UPDATE`;
    const actor = await tx.user.findUnique({where: {id: actorId}, select: {role: true, emailVerified: true, bannedAt: true}});
    if (!mayEnterAdmin(actor) || actor.role !== 'OWNER') throw new HttpError('OWNER_ONLY', 403);
    // Serialise repeated additions and lock an existing recipient against concurrent role/ban changes.
    const matches = await tx.user.findMany({where: {email: {equals: email, mode: 'insensitive'}}, take: 2,
      select: {id: true, email: true, role: true, bannedAt: true}});
    if (matches.length > 1) throw new HttpError('EMAIL_CONFLICT', 409);
    const existing = matches[0];
    if (existing?.id === actorId) throw new HttpError('SELF_ACTION', 400);
    if (existing?.role === 'OWNER') throw new HttpError('FORBIDDEN', 403);
    if (existing?.bannedAt) throw new HttpError('USER_BANNED', 409);
    if (existing) {
      if (existing.email !== email) {
        await tx.user.update({where: {id: existing.id}, data: {email}});
        await audit(tx, actorId, 'USER_EMAIL_NORMALIZE', 'User', existing.id, {from: existing.email, to: email});
      }
      if (existing.role !== role) await setUserRole(existing.id, role, actorId, tx);
      return {id: existing.id, email, role, scope: 'global' as const, created: false};
    }
    const user = await tx.user.create({data: {id: randomUUID(), name: email, email, role, emailVerified: false},
      select: {id: true, email: true, role: true}});
    await audit(tx, actorId, 'USER_ADMIN_ADD', 'User', user.id, {email, role});
    return {...user, scope: 'global' as const, created: true};
  });
}
