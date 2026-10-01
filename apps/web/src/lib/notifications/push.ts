import webpush from 'web-push';
import {z} from 'zod';
import {db} from '@dance/db';
import {localizeUrl, noteLocale, renderNotification} from './render';
// Web Push is optional: without both VAPID keys every function here is a silent no-op.
export function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim(), privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:hello@dance.local'};
}
export const pushEnabled = () => !!vapid();
// The server posts to the endpoint a browser gives us, so only real push services are accepted (no SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', '.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];
export function allowedEndpoint(value: string) {
  let url: URL;
  try {url = new URL(value);} catch {return false;}
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const extra = (process.env.PUSH_EXTRA_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return [...PUSH_HOSTS, ...extra].some(host => host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host);
}
const key = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+=*$/);
export const subscriptionSchema = z.object({endpoint: z.string().max(2048), keys: z.object({p256dh: key(40, 200), auth: key(8, 100)})});
export const endpointSchema = z.object({endpoint: z.string().min(1).max(2048)});
const MAX_DEVICES = 10;
// One row per browser. A device that changes hands (another account signs in) moves to the new owner.
export async function saveSubscription(userId: string, input: z.infer<typeof subscriptionSchema>) {
  const data = {userId, p256dh: input.keys.p256dh, auth: input.keys.auth};
  await db.pushSubscription.upsert({where: {endpoint: input.endpoint}, create: {endpoint: input.endpoint, ...data}, update: data});
  const extra = await db.pushSubscription.findMany({where: {userId}, orderBy: {createdAt: 'desc'}, skip: MAX_DEVICES, select: {id: true}});
  if (extra.length) await db.pushSubscription.deleteMany({where: {id: {in: extra.map(row => row.id)}}});
}
export async function removeSubscription(userId: string, endpoint: string) {
  return (await db.pushSubscription.deleteMany({where: {userId, endpoint}})).count;
}
export type PushPreferences = {pushReminders: boolean; pushRsvp: boolean; pushChat: boolean};
const gates: Record<string, keyof PushPreferences> = {EVENT_REMINDER: 'pushReminders', NEW_ATTENDEE: 'pushRsvp', CHAT_MESSAGE: 'pushChat'};
// Three types have a switch; everything else is pushed whenever the device is subscribed. No row means defaults (all on).
export function pushAllowed(type: string, preferences?: Partial<PushPreferences> | null) {
  const gate = gates[type];
  return !gate || (preferences?.[gate] ?? true);
}
type Target = {endpoint: string; keys: {p256dh: string; auth: string}};
type Sender = (target: Target, payload: string, options: webpush.RequestOptions) => Promise<unknown>;
const real: Sender = (target, payload, options) => webpush.sendNotification(target, payload, options);
let sender = real;
// Tests replace the network call.
export function setPushSender(next: Sender | null) {sender = next || real;}
export async function sendPush(userId: string, type: string, data: unknown, url?: string | null) {
  const keys = vapid(), result = {sent: 0, removed: 0, failed: 0};
  if (!keys) return result;
  const user = await db.user.findUnique({where: {id: userId}, select: {locale: true, bannedAt: true,
    notificationPreference: {select: {pushReminders: true, pushRsvp: true, pushChat: true}},
    pushSubscriptions: {select: {id: true, endpoint: true, p256dh: true, auth: true}}}});
  if (!user || user.bannedAt || !user.pushSubscriptions.length || !pushAllowed(type, user.notificationPreference)) return result;
  const locale = noteLocale(user.locale), text = renderNotification(locale, type, data);
  const subject = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const payload = JSON.stringify({...text, type, url: localizeUrl(url, locale) || '/' + locale + '/notifications',
    // The same occurrence or conversation replaces its earlier notification instead of stacking.
    tag: [type, subject.occurrenceId || subject.eventId || subject.conversationId || ''].join(':').slice(0, 120)});
  const options = {vapidDetails: keys, TTL: type === 'EVENT_REMINDER' ? 2 * 3600 : 24 * 3600, urgency: type === 'EVENT_REMINDER' ? 'high' as const : 'normal' as const};
  const dead: string[] = [];
  await Promise.all(user.pushSubscriptions.map(async row => {
    try {
      await sender({endpoint: row.endpoint, keys: {p256dh: row.p256dh, auth: row.auth}}, payload, options);
      result.sent++;
    } catch (error) {
      const status = (error as {statusCode?: number})?.statusCode;
      // The push service says this subscription is gone for good.
      if (status === 404 || status === 410) dead.push(row.id);
      else {
        result.failed++;
        console.error(JSON.stringify({level: 'error', event: 'push_failed', status: status ?? null, message: status ? undefined : error instanceof Error ? error.message : 'unknown'}));
      }
    }
  }));
  if (dead.length) result.removed = (await db.pushSubscription.deleteMany({where: {id: {in: dead}}})).count;
  return result;
}
