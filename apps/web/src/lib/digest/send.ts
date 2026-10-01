import nodemailer, {type Transporter} from 'nodemailer';
import {db} from '@dance/db';
import {DateTime} from 'luxon';
import {siteUrl} from '../mail';
import type {StyleNode} from '../catalogue/tree';
import {appLabel, courseLocale, courseText} from '../courses/messages';
import {buildDigest, type Digest, type DigestEvent} from './build';
import {unsubscribeToken} from './token';
export type DigestMail = {to: string; subject: string; text: string; html: string; headers: Record<string, string>};
export type Deliver = (mail: DigestMail) => Promise<unknown>;
// lib/mail.ts sends plain text without custom headers; this transport reads the same SMTP settings and adds HTML and List-Unsubscribe.
let transport: Transporter | null = null;
const mailer = () => transport ??= nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1', port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === 'true',
  ...(process.env.SMTP_USER ? {auth: {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD}} : {})
});
export const smtpDeliver: Deliver = mail => mailer().sendMail({from: process.env.SMTP_FROM || 'Dance Community <hello@dance.local>', ...mail});
const escape = (value: string) => value.replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
/** Localized plain text plus a simple HTML twin: no remote images, no tracking pixels, no rewritten links. */
export function renderDigest(digest: Digest): DigestMail {
  const locale = courseLocale(digest.locale), t = (key: string, values?: Record<string, string | number>) => courseText(locale, key, values);
  const origin = siteUrl(), token = unsubscribeToken(digest.userId);
  const unsubscribe = origin + '/' + locale + '/unsubscribe?token=' + token, oneClick = origin + '/api/digest/unsubscribe?token=' + token;
  const settings = origin + '/' + locale + '/settings', calendar = origin + '/' + locale + '/calendar';
  const heading = digest.place ? t('digestSubjectPlace', {place: clean(digest.place)}) : t('digestSubject');
  const dayName = (date: string) => new Intl.DateTimeFormat(locale, {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(date + 'T12:00:00Z'));
  const time = (event: DigestEvent) => {
    const options = {hour: '2-digit', minute: '2-digit', timeZoneName: 'short'} as const;
    try {return new Intl.DateTimeFormat(locale, {...options, timeZone: event.timezone}).format(event.startsAt);}
    catch {return new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'}).format(event.startsAt);}
  };
  const facts = (event: DigestEvent) => [[event.venue, event.city].filter(Boolean).map(value => clean(value!)).join(', '), appLabel(locale, 'kind_' + event.kind),
    event.level !== 'UNSPECIFIED' ? appLabel(locale, 'level_' + event.level) : '', event.priceText ? clean(event.priceText) : '',
    event.extraDates ? t('digestMoreDates', {count: event.extraDates}) : ''].filter(Boolean).join(' · ');
  const link = (event: DigestEvent) => origin + '/' + locale + '/events/' + event.slug + '?date=' + encodeURIComponent(event.startsAt.toISOString());
  const more = digest.more > 0 ? t('digestMore', {count: digest.more}) : '';
  const text = [heading, t('digestIntro'),
    ...digest.days.map(day => [dayName(day.date).toUpperCase(), ...day.events.map(event => time(event) + ' — ' + clean(event.title) + '\n' + facts(event) + '\n' + link(event))].join('\n\n')),
    [more, t('digestOpenCalendar') + ': ' + calendar].filter(Boolean).join('\n'),
    [t('digestWhy'), t('digestUnsubscribe') + ': ' + unsubscribe, t('digestSettings') + ': ' + settings].join('\n')].join('\n\n');
  const a = 'color:#253b2f';
  const html = '<!doctype html><html lang="' + locale + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(heading) + '</title></head>'
    + '<body style="margin:0;padding:24px;background:#f6f4ee;color:#202822;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6">'
    + '<div style="max-width:560px;margin:0 auto"><h1 style="font-size:24px;line-height:1.3;margin:0 0 12px">' + escape(heading) + '</h1>'
    + '<p style="margin:0 0 20px">' + escape(t('digestIntro')) + '</p>'
    + digest.days.map(day => '<h2 style="font-size:17px;line-height:1.4;margin:24px 0 8px;padding-top:14px;border-top:1px solid #d9ddd2">' + escape(dayName(day.date)) + '</h2>'
      + '<ul style="margin:0;padding:0;list-style:none">' + day.events.map(event => '<li style="margin:0 0 14px">'
        + '<a href="' + escape(link(event)) + '" style="' + a + ';font-weight:bold">' + escape(clean(event.title)) + '</a><br>'
        + '<span>' + escape(time(event)) + '</span><br><span style="font-size:14px;color:#4b554a">' + escape(facts(event)) + '</span></li>').join('') + '</ul>').join('')
    + '<p style="margin:24px 0">' + (more ? escape(more) + '<br>' : '')
    + '<a href="' + escape(calendar) + '" style="display:inline-block;margin-top:10px;background:#253b2f;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:24px">' + escape(t('digestOpenCalendar')) + '</a></p>'
    + '<p style="margin:0;font-size:13px;color:#4b554a;border-top:1px solid #d9ddd2;padding-top:14px">' + escape(t('digestWhy'))
    + '<br><a href="' + escape(unsubscribe) + '" style="' + a + '">' + escape(t('digestUnsubscribe')) + '</a> · <a href="' + escape(settings) + '" style="' + a + '">' + escape(t('digestSettings')) + '</a></p>'
    + '</div></body></html>';
  // RFC 8058: mail clients POST to the https link without showing a page; the visible link opens a confirmation page instead.
  return {to: digest.email, subject: heading + ' · Dance Community', text, html,
    headers: {'List-Unsubscribe': '<' + oneClick + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Auto-Response-Suppress': 'All'}};
}
/** Monday 00:00 UTC of the ISO week containing `now`: one digest per account per ISO week. */
export const digestWeekStart = (now: Date) => DateTime.fromJSDate(now, {zone: 'UTC'}).startOf('week').toJSDate();
/**
 * Atomically takes this week's digest for one account. The row lock makes a second worker wait and then see the new
 * "digestSentAt", so exactly one caller gets `claimed: true`. `previous` lets a failed delivery give the claim back.
 */
export async function claimDigest(userId: string, now = new Date()) {
  const weekStart = digestWeekStart(now);
  const rows = await db.$queryRaw<{previous: Date | null}[]>`
    UPDATE "NotificationPreference" p SET "digestSentAt" = ${now}
    FROM (SELECT "userId", "digestSentAt" FROM "NotificationPreference" WHERE "userId" = ${userId} FOR UPDATE) old
    WHERE p."userId" = old."userId" AND p."emailDigest" = true
      AND (old."digestSentAt" IS NULL OR old."digestSentAt" < ${weekStart})
      AND (p."digestSentAt" IS NULL OR p."digestSentAt" < ${weekStart})
    RETURNING old."digestSentAt" AS previous`;
  return rows.length ? {claimed: true as const, previous: rows[0].previous} : {claimed: false as const, previous: null};
}
export type DigestOutcome = 'sent' | 'empty' | 'already' | 'failed';
/**
 * Builds, claims and sends one digest. Nothing is claimed for an empty digest, so "digestSentAt" always means a real email.
 * The claim comes before the delivery (at most one email per week even with several workers) and is returned when SMTP fails.
 */
export async function sendDigest(userId: string, now = new Date(), deliver: Deliver = smtpDeliver, styleTree?: readonly StyleNode[]): Promise<DigestOutcome> {
  const digest = await buildDigest(userId, now, styleTree);
  if (!digest) return 'empty';
  const mail = renderDigest(digest), claim = await claimDigest(userId, now);
  if (!claim.claimed) return 'already';
  try {
    await deliver(mail);
    return 'sent';
  } catch (error) {
    await db.notificationPreference.updateMany({where: {userId, digestSentAt: now}, data: {digestSentAt: claim.previous}}).catch(() => {});
    console.error(JSON.stringify({level: 'error', event: 'digest_failed', userId, message: error instanceof Error ? error.message : 'unknown'}));
    return 'failed';
  }
}
/** Fans out over every subscriber that has not received this week's digest, in id-ordered batches with a small pool. */
export async function sendWeeklyDigests(now = new Date(), options: {batch?: number; concurrency?: number; deliver?: Deliver; userIds?: string[]} = {}) {
  const {batch = 100, concurrency = 4, deliver = smtpDeliver} = options, weekStart = digestWeekStart(now);
  const result = {candidates: 0, sent: 0, empty: 0, already: 0, failed: 0};
  const styleTree = await db.danceStyle.findMany({select: {id: true, slug: true, name: true, parentId: true}});
  for (let cursor = '';;) {
    const rows = await db.notificationPreference.findMany({
      where: {emailDigest: true, userId: {gt: cursor, ...(options.userIds ? {in: options.userIds} : {})}, OR: [{digestSentAt: null}, {digestSentAt: {lt: weekStart}}],
        user: {emailVerified: true, bannedAt: null}},
      orderBy: {userId: 'asc'}, take: batch, select: {userId: true}});
    if (!rows.length) break;
    cursor = rows.at(-1)!.userId;
    result.candidates += rows.length;
    const queue = rows.map(row => row.userId);
    await Promise.all(Array.from({length: Math.min(concurrency, queue.length)}, async () => {
      for (let userId = queue.shift(); userId; userId = queue.shift()) {
        // One broken account must not stop the batch.
        const outcome = await sendDigest(userId, now, deliver, styleTree).catch(error => {
          console.error(JSON.stringify({level: 'error', event: 'digest_failed', userId, message: error instanceof Error ? error.message : 'unknown'}));
          return 'failed' as const;
        });
        result[outcome]++;
      }
    }));
    if (rows.length < batch) break;
  }
  console.log(JSON.stringify({level: 'info', event: 'digest_run', week: weekStart.toISOString(), ...result}));
  return result;
}
/** The preference switch behind PUT /api/digest/subscription and the unsubscribe link. */
export async function setDigestSubscription(userId: string, enabled: boolean) {
  await db.notificationPreference.upsert({where: {userId}, create: {userId, emailDigest: enabled}, update: {emailDigest: enabled}});
  return {enabled};
}
export async function digestSubscription(userId: string) {
  return {enabled: !!(await db.notificationPreference.findUnique({where: {userId}, select: {emailDigest: true}}))?.emailDigest};
}
