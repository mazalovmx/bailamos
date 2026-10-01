import {setTimeout as sleep} from 'node:timers/promises';
import en from './messages/en.json';
import es from './messages/es.json';
import ru from './messages/ru.json';
// Thin client for the Telegram Bot API (plain HTTPS, no SDK). The whole feature is off without TELEGRAM_BOT_TOKEN.
export type BotLocale = 'en' | 'es' | 'ru';
export type MessageKey = keyof typeof en;
const catalogues: Record<BotLocale, Record<string, string>> = {en, es, ru};
export const botLocale = (value?: string | null): BotLocale => value === 'es' || value === 'ru' ? value : 'en';
// Plain text of a message. It is NOT escaped: pass the result through esc() before it goes into an HTML message.
export function t(locale: BotLocale, key: MessageKey, values: Record<string, string | number> = {}) {
  return (catalogues[locale][key] ?? catalogues.en[key] ?? '').replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
// Messages are sent with parse_mode=HTML, where only these characters are special. Quotes matter inside href="...".
export const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const link = (url: string, label: string) => '<a href="' + esc(url) + '">' + esc(label) + '</a>';
export function botConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  return {token, secret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '', username: (process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, ''),
    api: (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '')};
}
export const botEnabled = () => !!botConfig();
export class TelegramError extends Error {
  constructor(public status: number, public description: string, public retryAfter?: number) {super('TELEGRAM_' + status);}
  // The user blocked the bot, deleted the chat or the account: nothing will ever be delivered there again.
  get gone() {return this.status === 403 || (this.status === 400 && /chat not found|user is deactivated/i.test(this.description));}
}
// Telegram allows about 30 messages a second overall. Calls leave one by one with a small gap; a 429 is retried once
// after the pause Telegram asks for. A queue that grows beyond MAX_QUEUE drops new calls instead of piling up.
const GAP_MS = 40, MAX_QUEUE = 500, MAX_RETRY_WAIT_S = 10;
let chain: Promise<unknown> = Promise.resolve(), last = 0, queued = 0;
async function request(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const config = botConfig();
  if (!config) throw new TelegramError(0, 'BOT_DISABLED');
  let response: Response;
  try {
    response = await fetch(config.api + '/bot' + config.token + '/' + method, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000)});
  } catch {throw new TelegramError(0, 'NETWORK');}
  const body = await response.json().catch(() => null) as {ok?: boolean; result?: unknown; description?: string; parameters?: {retry_after?: number}} | null;
  if (response.ok && body?.ok) return body.result;
  throw new TelegramError(response.status, String(body?.description || '').slice(0, 200), body?.parameters?.retry_after);
}
export function callApi(method: string, payload: Record<string, unknown>): Promise<unknown> {
  if (queued >= MAX_QUEUE) return Promise.reject(new TelegramError(0, 'QUEUE_FULL'));
  queued++;
  const run = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {return await request(method, payload);} catch (error) {
      if (!(error instanceof TelegramError) || error.status !== 429 || (error.retryAfter ?? 1) > MAX_RETRY_WAIT_S) throw error;
      await sleep((error.retryAfter ?? 1) * 1000);
      return await request(method, payload);
    } finally {last = Date.now();}
  }).finally(() => {queued--;});
  chain = run.catch(() => undefined);
  return run;
}
export type Button = {text: string; callback_data?: string; url?: string};
// `html` must already be escaped (esc/link). Telegram refuses messages longer than 4096 characters.
export function sendMessage(chatId: string, html: string, buttons?: Button[][]) {
  return callApi('sendMessage', {chat_id: chatId, text: html.slice(0, 4096), parse_mode: 'HTML', link_preview_options: {is_disabled: true},
    ...(buttons?.length ? {reply_markup: {inline_keyboard: buttons}} : {})});
}
