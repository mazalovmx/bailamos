import {z} from 'zod';
import {db} from '@dance/db';
import {localizeUrl, renderNotification} from './render';
export const PAGE_SIZE = 20;
export type NotificationItem = {id: string; type: string; title: string; body: string; url: string | null; read: boolean; createdAt: string};
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional();
// Newest first. Titles, bodies and links are produced for the reader's interface language.
export async function listNotifications(userId: string, locale: string, cursor?: string) {
  // A cursor is only honoured when it points at the reader's own row.
  const from = cursor ? await db.notification.findFirst({where: {id: cursor, userId}, select: {id: true}}) : null;
  const rows = await db.notification.findMany({where: {userId}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: PAGE_SIZE + 1,
    ...(from ? {cursor: {id: from.id}, skip: 1} : {})});
  const page = rows.slice(0, PAGE_SIZE);
  return {items: page.map((row): NotificationItem => ({id: row.id, type: row.type, ...renderNotification(locale, row.type, row.data),
    url: localizeUrl(row.url, locale), read: !!row.readAt, createdAt: row.createdAt.toISOString()})),
    nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null};
}
export const unreadCount = (userId: string) => db.notification.count({where: {userId, readAt: null}});
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const readSchema = z.union([z.object({all: z.literal(true)}).strict(), z.object({id}).strict(), z.object({ids: z.array(id).min(1).max(100)}).strict()]);
export async function markRead(userId: string, input: z.infer<typeof readSchema>) {
  const ids = 'all' in input ? null : 'id' in input ? [input.id] : input.ids;
  const {count} = await db.notification.updateMany({where: {userId, readAt: null, ...(ids ? {id: {in: ids}} : {})}, data: {readAt: new Date()}});
  return {updated: count, unread: await unreadCount(userId)};
}
export const preferenceKeys = ['pushReminders', 'pushRsvp', 'pushChat', 'emailEvents', 'emailDigest'] as const;
export type Preferences = Record<typeof preferenceKeys[number], boolean>;
export const defaultPreferences: Preferences = {pushReminders: true, pushRsvp: true, pushChat: true, emailEvents: true, emailDigest: false};
const flag = z.boolean().optional();
export const preferencesSchema = z.object({pushReminders: flag, pushRsvp: flag, pushChat: flag, emailEvents: flag, emailDigest: flag}).strict()
  .refine(value => Object.values(value).some(entry => entry !== undefined));
const pick = (row: Preferences): Preferences => Object.fromEntries(preferenceKeys.map(key => [key, row[key]])) as Preferences;
export async function getPreferences(userId: string) {
  const row = await db.notificationPreference.findUnique({where: {userId}});
  return row ? pick(row) : {...defaultPreferences};
}
export async function savePreferences(userId: string, input: z.infer<typeof preferencesSchema>) {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  return pick(await db.notificationPreference.upsert({where: {userId}, create: {userId, ...data}, update: data}));
}
