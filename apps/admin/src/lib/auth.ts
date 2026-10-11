import {betterAuth} from 'better-auth';
import {prismaAdapter} from '@better-auth/prisma-adapter';
import {APIError} from 'better-auth/api';
import {db} from '@dance/db';
import {adminOrigin} from './env';
import {adminGoogleCredentials, mayEnterAdmin} from './auth-policy';
// Same users, database and secret as the web app, but a separate instance: its own cookie prefix (so a web session on the
// same host never doubles as an admin session), no registration, and sessions only for verified staff.
const google = adminGoogleCredentials();
export const auth = betterAuth({
  appName: 'Dance Community Admin',
  baseURL: adminOrigin(),
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {provider: 'postgresql'}),
  emailAndPassword: {enabled: process.env.EMAIL_AUTH_ENABLED !== 'false', disableSignUp: true, requireEmailVerification: true, minPasswordLength: 10},
  socialProviders: google ? {google: {...google, prompt: 'select_account', disableSignUp: true, disableImplicitSignUp: true}} : {},
  account: {accountLinking: {enabled: true, allowDifferentEmails: false}},
  user: {additionalFields: {
    role: {type: 'string', required: false, defaultValue: 'USER', input: false},
    bannedAt: {type: 'date', required: false, input: false, returned: false},
    banReason: {type: 'string', required: false, input: false, returned: false}
  }},
  session: {expiresIn: 60 * 60 * 12, updateAge: 60 * 60},
  advanced: {cookiePrefix: 'dance-admin'},
  rateLimit: {enabled: true, storage: 'database', window: 60, max: 120, customRules: {'/sign-in/email': {window: 60, max: 5}, '/sign-in/social': {window: 60, max: 10}}},
  databaseHooks: {user: {create: {before: async () => {
    throw new APIError('FORBIDDEN', {message: 'ADMIN_REGISTRATION_DISABLED', code: 'ADMIN_REGISTRATION_DISABLED'});
  }}}, session: {create: {before: async session => {
    const user = await db.user.findUnique({where: {id: session.userId}, select: {role: true, bannedAt: true, emailVerified: true}});
    if (!mayEnterAdmin(user)) throw new APIError('FORBIDDEN', {message: 'NOT_STAFF', code: 'NOT_STAFF'});
  }}}}
});
