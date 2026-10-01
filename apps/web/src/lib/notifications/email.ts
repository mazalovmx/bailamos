import nodemailer, {type Transporter} from 'nodemailer';
import {db} from '@dance/db';
import {siteUrl} from '../mail';
import {localizeUrl, noteLocale, noteText, renderNotification} from './render';
// lib/mail.ts sends plain text only; this transport reads the same SMTP settings and adds an HTML part.
let transport: Transporter | null = null;
const mailer = () => transport ??= nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1', port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === 'true',
  ...(process.env.SMTP_USER ? {auth: {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD}} : {})
});
const escape = (value: string) => value.replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';');
export type MailParts = {subject: string; text: string; html: string};
// Plain text plus a minimal HTML twin: no remote images, no tracking pixels, no rewritten links.
export function notificationMail(localeValue: string | null | undefined, type: string, data: unknown, url?: string | null): MailParts {
  const locale = noteLocale(localeValue), {title, body} = renderNotification(locale, type, data);
  const path = localizeUrl(url, locale), link = path ? siteUrl() + path : null, settings = siteUrl() + '/' + locale + '/settings';
  const open = noteText(locale, 'mailOpen'), footer = noteText(locale, 'mailFooter', {url: settings});
  const text = [title, body, link ? open + ': ' + link : '', footer].filter(Boolean).join('\n\n');
  const html = '<!doctype html><html lang="' + locale + '"><head><meta charset="utf-8"><title>' + escape(title) + '</title></head>'
    + '<body style="margin:0;padding:24px;background:#f6f4ee;color:#202822;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6">'
    + '<div style="max-width:520px;margin:0 auto"><h1 style="font-size:22px;line-height:1.3;margin:0 0 12px">' + escape(title) + '</h1>'
    + (body ? '<p style="margin:0 0 20px">' + escape(body) + '</p>' : '')
    + (link ? '<p style="margin:0 0 24px"><a href="' + escape(link) + '" style="display:inline-block;background:#253b2f;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:24px">' + escape(open) + '</a></p>' : '')
    + '<p style="margin:0;font-size:13px;color:#4b554a;border-top:1px solid #d9ddd2;padding-top:14px">' + escape(noteText(locale, 'mailFooter', {url: ''})).replace(/[:\s]+$/, '')
    + ': <a href="' + escape(settings) + '" style="color:#253b2f">' + escape(settings) + '</a></p></div></body></html>';
  return {subject: title, text, html};
}
// Failures are logged, never thrown: mail must not break the action that caused it.
export async function sendHtmlMail(to: string, parts: MailParts) {
  try {
    await mailer().sendMail({from: process.env.SMTP_FROM || 'Dance Community <hello@dance.local>', to,
      subject: parts.subject + ' · Dance Community', text: parts.text, html: parts.html});
    return true;
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'mail_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return false;
  }
}
export type EmailType = 'EVENT_CANCELLED' | 'EVENT_INVITE' | 'EVENT_REMINDER' | 'CLAIM_DECIDED';
// Writes to one account in its own language. Event emails obey the "emailEvents" switch (on by default);
// a claim decision is an account matter and is always sent. Returns whether a message left.
export async function sendNotificationEmail(userId: string, type: EmailType, data: unknown, url?: string | null) {
  const user = await db.user.findUnique({where: {id: userId}, select: {email: true, locale: true, emailVerified: true, bannedAt: true,
    notificationPreference: {select: {emailEvents: true}}}});
  if (!user || user.bannedAt || !user.emailVerified) return false;
  if (type !== 'CLAIM_DECIDED' && !(user.notificationPreference?.emailEvents ?? true)) return false;
  return sendHtmlMail(user.email, notificationMail(user.locale, type, data, url));
}
export const sendEventCancelledEmail = (userId: string, data: {title: string; date?: string; timezone?: string}, url?: string | null) =>
  sendNotificationEmail(userId, 'EVENT_CANCELLED', data, url);
export const sendEventInviteEmail = (userId: string, data: {title: string; inviter: string}, url?: string | null) =>
  sendNotificationEmail(userId, 'EVENT_INVITE', data, url);
export const sendEventReminderEmail = (userId: string, data: {title: string; startsAt: string; timezone: string; place?: string}, url?: string | null) =>
  sendNotificationEmail(userId, 'EVENT_REMINDER', data, url);
export const sendClaimDecidedEmail = (userId: string, data: {name: string; status: 'APPROVED' | 'REJECTED'; reason?: string | null}, url?: string | null) =>
  sendNotificationEmail(userId, 'CLAIM_DECIDED', data, url);
