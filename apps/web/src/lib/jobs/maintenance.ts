import {db} from '@dance/db';
import type {JobDef} from '../../worker/types';
const DAY = 86400_000;
export const READ_NOTIFICATION_DAYS = 90;
/**
 * Daily housekeeping of rows nobody will read again:
 * - RateLimit: Better Auth counters (lastRequest in ms) idle for a day — every window is a minute long;
 * - Verification: tokens (email, reset, magic link) that expired more than a day ago;
 * - Notification: read ones older than 90 days — unread ones are kept;
 * - EventInvite: pending invitations past their expiry (accepted ones stay as the record of who joined how).
 */
export async function cleanupStaleRows(now = new Date()) {
  const [rateLimits, verifications, notifications, invites] = await Promise.all([
    db.rateLimit.deleteMany({where: {lastRequest: {lt: BigInt(now.getTime() - DAY)}}}),
    db.verification.deleteMany({where: {expiresAt: {lt: new Date(now.getTime() - DAY)}}}),
    db.notification.deleteMany({where: {readAt: {not: null}, createdAt: {lt: new Date(now.getTime() - READ_NOTIFICATION_DAYS * DAY)}}}),
    db.eventInvite.deleteMany({where: {acceptedAt: null, expiresAt: {lt: now}}})]);
  return {rateLimits: rateLimits.count, verifications: verifications.count, notifications: notifications.count, invites: invites.count};
}
export const maintenanceJobs: JobDef[] = [
  {name: 'ratelimit.cleanup', cron: '30 3 * * *', attempts: 2, handler: () => cleanupStaleRows()}
];
