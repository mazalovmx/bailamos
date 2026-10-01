import {db, Prisma} from '@dance/db';
// Notification types are rendered by the notification centre from Notifications messages: key "type_<type>".
export type NotificationType = 'EVENT_CANCELLED' | 'EVENT_REMINDER' | 'EVENT_INVITE' | 'NEW_ATTENDEE' | 'NEW_FOLLOWER'
  | 'PARTNER_MATCH' | 'CHAT_MESSAGE' | 'CLAIM_DECIDED' | 'MODERATION' | 'NEW_POST' | 'GROUP_INVITE';
type Delivery = (userId: string, type: NotificationType, data: Prisma.InputJsonObject, url?: string) => Promise<void>;
const deliveries: Delivery[] = [];
// Push and other channels register here so that domain code only ever calls notify().
export function registerDelivery(delivery: Delivery) {deliveries.push(delivery);}
export async function notify(userIds: string[], type: NotificationType, data: Prisma.InputJsonObject, url?: string) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await db.notification.createMany({data: unique.map(userId => ({userId, type, data, url}))});
  await Promise.all(unique.flatMap(userId => deliveries.map(deliver => deliver(userId, type, data, url).catch(() => undefined))));
}
