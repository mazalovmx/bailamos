import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {botConfig, botLocale} from './api';
// Connecting a Telegram chat to an account. The site hands the signed-in user a one-time token inside a t.me deep link;
// the bot receives it as "/start <token>" and binds the chat. Only a hash of the token is stored, for ten minutes.
const PREFIX = 'telegram-link:', TTL_MS = 10 * 60_000;
const identifier = (token: string) => PREFIX + createHash('sha256').update(token).digest('hex');
export const tokenPattern = /^[A-Za-z0-9_-]{32,64}$/;
export async function createLinkToken(userId: string, now = new Date()) {
  const config = botConfig();
  if (!config?.username) return null;
  // 32 random bytes as base64url: 43 characters, within the 64 Telegram allows for a start parameter.
  const token = randomBytes(32).toString('base64url'), expiresAt = new Date(now.getTime() + TTL_MS);
  await db.$transaction([
    // One live token per user, and expired ones do not pile up.
    db.verification.deleteMany({where: {identifier: {startsWith: PREFIX}, OR: [{value: userId}, {expiresAt: {lt: now}}]}}),
    db.verification.create({data: {id: randomUUID(), identifier: identifier(token), value: userId, expiresAt}})
  ]);
  return {token, url: 'https://t.me/' + config.username + '?start=' + token, expiresAt};
}
// Binds the chat to the token's user. The token is deleted first, so it works exactly once even under concurrent use.
export async function consumeLinkToken(token: string, chatId: string, now = new Date()): Promise<string | null> {
  if (!tokenPattern.test(token)) return null;
  return db.$transaction(async tx => {
    const row = await tx.verification.findFirst({where: {identifier: identifier(token)}});
    if (!row || !(await tx.verification.deleteMany({where: {id: row.id}})).count || row.expiresAt <= now) return null;
    const user = await tx.user.findUnique({where: {id: row.value}, select: {id: true, locale: true, bannedAt: true}});
    if (!user || user.bannedAt) return null;
    // An account has one chat: a previous one is disconnected (and stops receiving notifications).
    await tx.telegramChat.updateMany({where: {userId: user.id, chatId: {not: chatId}}, data: {userId: null, notify: false}});
    await tx.telegramChat.upsert({where: {chatId}, create: {chatId, userId: user.id, notify: true, locale: botLocale(user.locale)}, update: {userId: user.id, notify: true}});
    return user.id;
  });
}
export async function unlinkUser(userId: string) {
  return (await db.telegramChat.updateMany({where: {userId}, data: {userId: null, notify: false}})).count;
}
export async function linkStatus(userId: string) {
  const chat = await db.telegramChat.findUnique({where: {userId}, select: {notify: true}});
  return {linked: !!chat, notify: chat?.notify ?? false};
}
