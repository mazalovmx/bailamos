import {betterAuth} from 'better-auth';
import {prismaAdapter} from '@better-auth/prisma-adapter';
import {APIError} from 'better-auth/api';
import {db} from '@dance/db';
import {adminOrigin} from './env';
// Same users, database and secret as the web app, but a separate instance: its own cookie prefix (so a web session on the
// same host never doubles as an admin session), password sign-in only, no registration, and sessions only for staff.
export const auth = betterAuth({
  appName: 'Dance Community Admin',
  baseURL: adminOrigin(),
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {provider: 'postgresql'}),
  emailAndPassword: {enabled: true, disableSignUp: true, requireEmailVerification: true, minPasswordLength: 10},
  user: {additionalFields: {
    role: {type: 'string', required: false, defaultValue: 'USER', input: false},
    bannedAt: {type: 'date', required: false, input: false, returned: false},
    banReason: {type: 'string', required: false, input: false, returned: false}
  }},
  session: {expiresIn: 60 * 60 * 12, updateAge: 60 * 60},
  advanced: {cookiePrefix: 'dance-admin'},
  rateLimit: {enabled: true, storage: 'database', window: 60, max: 120, customRules: {'/sign-in/email': {window: 60, max: 5}}},
  databaseHooks: {session: {create: {before: async session => {
    const user = await db.user.findUnique({where: {id: session.userId}, select: {role: true, bannedAt: true}});
    if (!user || user.bannedAt || user.role === 'USER') throw new APIError('FORBIDDEN', {message: 'NOT_STAFF', code: 'NOT_STAFF'});
  }}}}
});
