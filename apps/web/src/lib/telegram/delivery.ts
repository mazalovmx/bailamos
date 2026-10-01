import {db} from '@dance/db';
import {siteUrl} from '../mail';
import {registerDelivery, type NotificationType} from '../notify';
import {localizeUrl, renderNotification} from '../notifications/render';
import {botEnabled, botLocale, esc, link, sendMessage, t, TelegramError} from './api';
// Notifications as Telegram messages for accounts with a connected chat and "notify" on.
// Only the kinds a person wants on their phone right away; the rest stays in the notification centre.
export const TELEGRAM_TYPES: readonly string[] = ['EVENT_REMINDER', 'EVENT_CANCELLED', 'PARTNER_MATCH', 'CHAT_MESSAGE'];
export async function telegramDelivery(userId: string, type: NotificationType | string, data: unknown, url?: string | null): Promise<void> {
  if (!botEnabled() || !TELEGRAM_TYPES.includes(type)) return;
  const chat = await db.telegramChat.findUnique({where: {userId}, select: {chatId: true, locale: true, notify: true, user: {select: {bannedAt: true}}}});
  if (!chat?.notify || chat.user?.bannedAt) return;
  const locale = botLocale(chat.locale), text = renderNotification(locale, type, data), path = localizeUrl(url, locale);
  const html = ['<b>' + esc(text.title.slice(0, 200)) + '</b>', text.body ? esc(text.body.slice(0, 600)) : '',
    path ? link(siteUrl() + path, t(locale, 'notificationLink')) : ''].filter(Boolean).join('\n');
  try {await sendMessage(chat.chatId, html);} catch (error) {
    // "Forbidden: bot was blocked by the user": stop trying until the person turns notifications on again.
    if (error instanceof TelegramError && error.gone) await db.telegramChat.updateMany({where: {chatId: chat.chatId}, data: {notify: false}});
    else console.error(JSON.stringify({level: 'error', event: 'telegram_delivery_failed', type, status: error instanceof TelegramError ? error.status : undefined}));
  }
}
// Call once in every process that calls notify() (web server and worker). Safe to call again after a hot reload.
const state = globalThis as {__danceTelegramDelivery?: boolean};
export function registerTelegramDelivery() {
  if (state.__danceTelegramDelivery) return;
  state.__danceTelegramDelivery = true;
  registerDelivery((userId, type, data, url) => telegramDelivery(userId, type, data, url));
}
