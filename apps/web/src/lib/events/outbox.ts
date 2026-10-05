import {db, type Prisma} from '@dance/db';
import {dispatchNotification, type NotificationType} from '../notify';
import {mailLocale, sendMail, siteUrl} from '../mail';
import {renderNotification} from '../notifications/render';
import '../notifications/register';

// Row locks avoid two workers delivering the same pending row. A stable Message-ID makes SMTP retries traceable.
// External delivery is at least once: SMTP acceptance and a database commit cannot be one transaction.
export async function drainEventDeliveries(limit = 20, deliverMail:typeof sendMail = sendMail) {
  let delivered = 0;
  for (let i = 0; i < limit; i++) {
    const result = await db.$transaction(async tx => {
      const [claim] = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "EventDelivery"
        WHERE "completedAt" IS NULL AND "retryAt" <= NOW() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!claim) return null;
      const row = await tx.eventDelivery.findUniqueOrThrow({where: claim, include: {user: {include: {notificationPreference: true}}}});
      const now = new Date(), data = row.data as Prisma.JsonObject;
      try {
        if (!row.user.bannedAt) {
          if (!row.emailSentAt && (row.user.notificationPreference?.emailEvents ?? true)) {
            const locale = mailLocale(row.user.locale), message = renderNotification(locale, row.type, data);
            const text = [message.body, data.previous ? String(data.previous) : '', data.previousPlace ? String(data.previousPlace) : '',
              data.place ? String(data.place) : '', data.mapUrl ? String(data.mapUrl) : '', row.url ? siteUrl() + row.url : ''].filter(Boolean).join('\n\n');
            if (!await deliverMail(row.user.email, message.title, text, row.id + '@events.dance.local')) throw new Error('SMTP_DELIVERY_FAILED');
          }
          await tx.eventDelivery.update({where: claim, data: {emailSentAt: row.emailSentAt || now}});
          if (!row.channelsSentAt) await dispatchNotification([row.userId], row.type as NotificationType, data, row.url || undefined, true);
        }
        await tx.eventDelivery.update({where: claim, data: {completedAt: now, channelsSentAt: now, lastError: null, attempts: {increment: 1}}});
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : 'DELIVERY_FAILED';
        await tx.eventDelivery.update({where: claim, data: {attempts: {increment: 1}, lastError: message,
          retryAt: new Date(Date.now() + Math.min(3600_000, 10_000 * 2 ** Math.min(row.attempts, 9)))}});
        console.error(JSON.stringify({level: 'error', event: 'event_delivery_failed', deliveryId: row.id, attempt: row.attempts + 1, message}));
        return false;
      }
    }, {timeout: 30_000});
    if (result === null) break;
    if (result) delivered++;
  }
  return {delivered};
}
export async function tryEventDelivery() {
  try {await drainEventDeliveries(1);}
  catch (error) {console.error(JSON.stringify({level:'error',event:'event_outbox_unavailable',message:error instanceof Error?error.message:'unknown'}));}
}
