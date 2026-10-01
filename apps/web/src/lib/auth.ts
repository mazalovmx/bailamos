import {betterAuth} from 'better-auth';
import {prismaAdapter} from '@better-auth/prisma-adapter';
import {createAuthMiddleware, APIError} from 'better-auth/api';
import {db} from '@dance/db';
import nodemailer from 'nodemailer';
const mail = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1', port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === 'true',
  ...(process.env.SMTP_USER ? {auth: {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD}} : {})
});
const emailText = {
  en: {verify: 'Confirm your email', reset: 'Reset your password', body: 'Open this link to continue:'},
  es: {verify: 'Confirma tu correo', reset: 'Restablece tu contraseña', body: 'Abre este enlace para continuar:'},
  ru: {verify: 'Подтвердите почту', reset: 'Сброс пароля', body: 'Откройте ссылку, чтобы продолжить:'}
};
async function send(user: {email: string; locale?: string}, url: string, kind: 'verify' | 'reset') {
  const copy = emailText[user.locale as keyof typeof emailText] || emailText.en;
  await mail.sendMail({from: process.env.SMTP_FROM || 'Dance Community <hello@dance.local>',
    to: user.email, subject: copy[kind] + ' · Dance Community', text: copy.body + '\n\n' + url});
}
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
  user: {additionalFields: {
    ageConfirmed: {type: 'boolean', required: true},
    locale: {type: 'string', required: false, defaultValue: 'en'}
  }},
  rateLimit: {enabled: true, storage: 'database', window: 60, max: 60,
    customRules: {'/sign-up/email': {window: 60, max: 5}, '/sign-in/email': {window: 60, max: 10},
      '/request-password-reset': {window: 60, max: 3}, '/send-verification-email': {window: 60, max: 3}}},
  hooks: {before: createAuthMiddleware(async ctx => {
    if (ctx.path === '/sign-up/email' && ctx.body?.ageConfirmed !== true)
      throw new APIError('BAD_REQUEST', {message: 'AGE_CONFIRMATION_REQUIRED'});
    if (ctx.path === '/sign-up/email' && !['en','es','ru'].includes(ctx.body?.locale || 'en'))
      throw new APIError('BAD_REQUEST', {message: 'INVALID_LOCALE'});
    if (ctx.path === '/sign-up/email' && (typeof ctx.body?.name !== 'string' || ctx.body.name.trim().length < 2 || ctx.body.name.length > 80))
      throw new APIError('BAD_REQUEST', {message: 'INVALID_NAME'});
  })}
});
