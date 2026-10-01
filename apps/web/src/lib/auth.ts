import {betterAuth} from 'better-auth';
import {prismaAdapter} from '@better-auth/prisma-adapter';
import {createAuthMiddleware, APIError} from 'better-auth/api';
import {magicLink} from 'better-auth/plugins/magic-link';
import {db} from '@dance/db';
import {sendMail, mailLocale, type MailLocale} from './mail';
import {logRegistrationConsents} from './account/consent';
const emailText: Record<MailLocale, {verify: string; reset: string; magic: string; body: string; magicBody: string}> = {
  en: {verify: 'Confirm your email', reset: 'Reset your password', magic: 'Your sign-in link', body: 'Open this link to continue:',
    magicBody: 'Open this link to sign in. It works once and expires in 10 minutes. If you did not ask for it, ignore this email.'},
  es: {verify: 'Confirma tu correo', reset: 'Restablece tu contraseña', magic: 'Tu enlace de acceso', body: 'Abre este enlace para continuar:',
    magicBody: 'Abre este enlace para iniciar sesión. Funciona una sola vez y caduca en 10 minutos. Si no lo has pedido, ignora este correo.'},
  ru: {verify: 'Подтвердите почту', reset: 'Сброс пароля', magic: 'Ссылка для входа', body: 'Откройте ссылку, чтобы продолжить:',
    magicBody: 'Откройте ссылку, чтобы войти. Она действует один раз и истекает через 10 минут. Если вы её не запрашивали, проигнорируйте это письмо.'}
};
async function send(user: {email: string; locale?: string | null}, url: string, kind: 'verify' | 'reset' | 'magic') {
  const copy = emailText[mailLocale(user.locale)];
  await sendMail(user.email, copy[kind], (kind === 'magic' ? copy.magicBody : copy.body) + '\n\n' + url);
}
// Google sign-in exists only when both credentials are configured; the UI hides the button otherwise.
export const googleEnabled = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
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
    sendVerificationEmail: async ({user, url}) => send(user, url, 'verify')
  },
  ...(googleEnabled() ? {socialProviders: {google: {
    clientId: process.env.GOOGLE_CLIENT_ID as string, clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
  }}} : {}),
  user: {additionalFields: {
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
      '/change-password': minute(5), '/change-email': minute(3), '/update-user': minute(10)}},
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
    if (ctx.path !== '/sign-up/email') return;
    if (ctx.body?.ageConfirmed !== true) throw fail('AGE_CONFIRMATION_REQUIRED');
    if (!['en','es','ru'].includes(ctx.body?.locale || 'en')) throw fail('INVALID_LOCALE');
    if (typeof ctx.body?.name !== 'string' || ctx.body.name.trim().length < 2 || ctx.body.name.length > 80) throw fail('INVALID_NAME');
  })}
});
