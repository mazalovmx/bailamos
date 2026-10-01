import {AsyncLocalStorage} from 'node:async_hooks';
import {betterAuth} from 'better-auth';
import {prismaAdapter} from '@better-auth/prisma-adapter';
import {createAuthMiddleware, APIError} from 'better-auth/api';
import {magicLink} from 'better-auth/plugins/magic-link';
import {db} from '@dance/db';
import {sendMail, mailLocale, type MailLocale} from './mail';
import {logRegistrationConsents} from './account/consent';
type MailKind = 'verify' | 'reset' | 'magic' | 'change';
const emailText: Record<MailLocale, {verify: string; reset: string; magic: string; change: string; body: string; magicBody: string; changeBody: string}> = {
  en: {verify: 'Confirm your email', change: 'Confirm your new email address',
    changeBody: 'Open this link to make this address the email of your Dance Community account. It expires in 1 hour. If you did not ask for it, ignore this email.', reset: 'Reset your password', magic: 'Your sign-in link', body: 'Open this link to continue:',
    magicBody: 'Open this link to sign in. It works once and expires in 10 minutes. If you did not ask for it, ignore this email.'},
  es: {verify: 'Confirma tu correo', change: 'Confirma tu nuevo correo',
    changeBody: 'Abre este enlace para que esta dirección sea el correo de tu cuenta de Dance Community. Caduca en 1 hora. Si no lo has pedido, ignora este correo.', reset: 'Restablece tu contraseña', magic: 'Tu enlace de acceso', body: 'Abre este enlace para continuar:',
    magicBody: 'Abre este enlace para iniciar sesión. Funciona una sola vez y caduca en 10 minutos. Si no lo has pedido, ignora este correo.'},
  ru: {verify: 'Подтвердите почту', change: 'Подтвердите новый адрес почты',
    changeBody: 'Откройте ссылку, чтобы этот адрес стал почтой вашего аккаунта Dance Community. Ссылка действует 1 час. Если вы этого не запрашивали, проигнорируйте письмо.', reset: 'Сброс пароля', magic: 'Ссылка для входа', body: 'Откройте ссылку, чтобы продолжить:',
    magicBody: 'Откройте ссылку, чтобы войти. Она действует один раз и истекает через 10 минут. Если вы её не запрашивали, проигнорируйте это письмо.'}
};
async function send(user: {email: string; locale?: string | null}, url: string, kind: MailKind) {
  const copy = emailText[mailLocale(user.locale)];
  await sendMail(user.email, copy[kind], (kind === 'magic' ? copy.magicBody : kind === 'change' ? copy.changeBody : copy.body) + '\n\n' + url);
}
// Google sign-in exists only when both credentials are configured; the UI hides the button otherwise.
export const googleEnabled = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
// Set by lib/account/email-change.ts once the password (or a fresh sign-in) has been checked; the bare Better Auth route is refused.
export const confirmedEmailChange = new AsyncLocalStorage<boolean>();
const fail = (code: string, status: 'BAD_REQUEST' | 'FORBIDDEN' = 'BAD_REQUEST') => new APIError(status, {message: code, code});
const minute = (max: number) => ({window: 60, max});
export const auth = betterAuth({
  appName: 'Dance Community',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {provider: 'postgresql'}),
  emailAndPassword: {
    enabled: true, minPasswordLength: 10, requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({user, url}) => send(user, url, 'reset')
  },
  emailVerification: {
    sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true,
    // During an email change the link goes to the new address, which is not yet the stored one.
    sendVerificationEmail: async ({user, url}) => {
      const stored = await db.user.findUnique({where: {id: user.id}, select: {email: true, locale: true}});
      await send({email: user.email, locale: stored?.locale ?? (user as {locale?: string | null}).locale}, url,
        stored && stored.email.toLowerCase() !== user.email.toLowerCase() ? 'change' : 'verify');
    }
  },
  ...(googleEnabled() ? {socialProviders: {google: {
    clientId: process.env.GOOGLE_CLIENT_ID as string, clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
  }}} : {}),
  // Explicit linking from settings only attaches a Google account with the same email address.
  account: {accountLinking: {enabled: true, allowDifferentEmails: false}},
  user: {
    // The new address must open a link before it replaces the old one; see lib/account/email-change.ts.
    changeEmail: {enabled: true},
    additionalFields: {
    // Google accounts start unconfirmed; onboarding collects the confirmation before a profile can exist.
    ageConfirmed: {type: 'boolean', required: false, defaultValue: false},
    locale: {type: 'string', required: false, defaultValue: 'en'},
    // Declared only so that Better Auth rejects or overrides any client attempt to set them.
    role: {type: 'string', required: false, defaultValue: 'USER', input: false},
    bannedAt: {type: 'date', required: false, input: false, returned: false},
    banReason: {type: 'string', required: false, input: false, returned: false}
  }},
  rateLimit: {enabled: true, storage: 'database', window: 60, max: 60,
    customRules: {'/sign-up/email': minute(5), '/sign-in/email': minute(10), '/sign-in/social': minute(10),
      '/sign-in/magic-link': minute(3), '/magic-link/verify': minute(10),
      '/request-password-reset': minute(3), '/reset-password': minute(5),
      '/send-verification-email': minute(3), '/verify-email': minute(10),
      '/change-password': minute(5), '/change-email': minute(3), '/update-user': minute(10),
      '/link-social': minute(5), '/unlink-account': minute(5), '/revoke-other-sessions': minute(5), '/revoke-sessions': minute(5)}},
  plugins: [magicLink({
    expiresIn: 600, storeToken: 'hashed',
    // Magic links only sign existing members in: registration must pass the age and policy confirmation.
    disableSignUp: true, rateLimit: minute(3),
    sendMagicLink: async ({email, url}) => {
      const user = await db.user.findUnique({where: {email: email.toLowerCase()}, select: {email: true, locale: true, bannedAt: true}});
      // Unknown and banned addresses get no mail and the same response, so the form reveals nothing.
      if (user && !user.bannedAt) await send(user, url, 'magic');
    }
  })],
  databaseHooks: {
    session: {create: {before: async session => {
      const user = await db.user.findUnique({where: {id: session.userId}, select: {bannedAt: true}});
      if (user?.bannedAt) throw fail('BANNED', 'FORBIDDEN');
    }}},
    user: {create: {after: async user => {
      if ((user as {ageConfirmed?: boolean}).ageConfirmed === true) await logRegistrationConsents(user.id);
    }}}
  },
  hooks: {before: createAuthMiddleware(async ctx => {
    // Sign-up is the only Better Auth route allowed to confirm age; later confirmation goes through onboarding, which logs it.
    if (ctx.path === '/update-user' && ctx.body && 'ageConfirmed' in ctx.body) throw fail('FIELD_NOT_ALLOWED');
    if (ctx.path === '/change-email' && !confirmedEmailChange.getStore()) throw fail('CONFIRMATION_REQUIRED', 'FORBIDDEN');
    if (ctx.path !== '/sign-up/email') return;
    if (ctx.body?.ageConfirmed !== true) throw fail('AGE_CONFIRMATION_REQUIRED');
    if (!['en','es','ru'].includes(ctx.body?.locale || 'en')) throw fail('INVALID_LOCALE');
    if (typeof ctx.body?.name !== 'string' || ctx.body.name.trim().length < 2 || ctx.body.name.length > 80) throw fail('INVALID_NAME');
  })}
});
