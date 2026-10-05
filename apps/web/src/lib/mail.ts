import nodemailer from 'nodemailer';
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1', port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === 'true',
  connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000,
  ...(process.env.SMTP_USER ? {auth: {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD}} : {})
});
export const siteUrl = () => new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
export type MailLocale = 'en' | 'es' | 'ru';
export const mailLocale = (value?: string | null): MailLocale => value === 'es' || value === 'ru' ? value : 'en';
// Plain-text transactional mail. Failures are logged, never thrown: mail must not break a user action.
export async function sendMail(to: string, subject: string, text: string, messageId?: string) {
  try {
    await transport.sendMail({from: process.env.SMTP_FROM || 'Dance Community <hello@dance.local>',
      to, subject: subject + ' · Dance Community', text, ...(messageId ? {messageId} : {})});
    return true;
  } catch (error) {
    console.error(JSON.stringify({level:'error',event:'mail_failed',message: error instanceof Error ? error.message : 'unknown'}));
    return false;
  }
}
