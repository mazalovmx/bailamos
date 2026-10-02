import {cityName} from '../catalogue/city-name';
import {DateTime} from 'luxon';
import {z} from 'zod';
import {db, type Prisma, type TelegramChat} from '@dance/db';
import {allCities, allStyles, styleDescendantIds, upcomingOccurrences, type CityOption} from '../catalogue/data';
import {normalize, rankMatches} from '../catalogue/search';
import {siteUrl} from '../mail';
import {rateLimit} from '../rate-limit';
import {botLocale, callApi, esc, link, sendMessage, t, TelegramError, type BotLocale, type Button, type MessageKey} from './api';
import {consumeLinkToken} from './link';
// Command router of the bot. Searching needs no account; an account is only connected for notifications.
const chatShape = z.object({id: z.number(), type: z.string().optional()});
const updateSchema = z.object({
  message: z.object({chat: chatShape, text: z.string().max(4096).optional(), from: z.object({language_code: z.string().optional()}).optional()}).optional(),
  callback_query: z.object({id: z.string(), data: z.string().max(64).optional(), message: z.object({chat: chatShape}).optional()}).optional()
});
export const PAGE_SIZE = 5, MAX_PAGE = 20;
type Mode = 'events' | 'today' | 'weekend' | 'search' | 'style';
const modes: readonly Mode[] = ['events', 'today', 'weekend', 'search', 'style'];
// Edit distance where swapping two neighbouring letters counts as one typo.
function distance(a: string, b: string) {
  let before: number[] = [], row = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) next[j] = Math.min(next[j], before[j - 2] + 1);
    }
    before = row;
    row = next;
  }
  return row[b.length];
}
// Exact, prefix and substring matches first (accent-insensitive, name or slug); then one or two typos are forgiven.
export function fuzzyPick<T extends {name: string; slug: string}>(items: readonly T[], query: string): T | null {
  const q = normalize(query.slice(0, 80));
  if (!q) return null;
  const ranked = rankMatches(items, query, 1)[0];
  if (ranked) return ranked;
  const allowed = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  const close = items.map(item => ({item, typos: Math.min(distance(q, normalize(item.name)), distance(q, normalize(item.slug)))}))
    .filter(entry => entry.typos <= allowed).sort((a, b) => a.typos - b.typos || a.item.name.localeCompare(b.item.name));
  return close[0]?.item ?? null;
}
function when(date: Date, zone: string, locale: BotLocale) {
  const options: Intl.DateTimeFormatOptions = {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'};
  try {return new Intl.DateTimeFormat(locale, {...options, timeZone: zone}).format(date);}
  catch {return new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'}).format(date);}
}
// Today: until local midnight. Weekend: Friday 18:00 to the end of Sunday, or what is left of it.
export function range(mode: Mode, zone: string, now: Date): {from: Date; to?: Date} {
  const local = DateTime.fromJSDate(now, {zone}).isValid ? DateTime.fromJSDate(now, {zone}) : DateTime.fromJSDate(now, {zone: 'UTC'});
  if (mode === 'today') return {from: now, to: local.endOf('day').toJSDate()};
  if (mode !== 'weekend') return {from: now};
  const sunday = local.plus({days: 7 - local.weekday}).endOf('day'), friday = sunday.minus({days: 2}).startOf('day').set({hour: 18});
  return {from: friday.toJSDate() > now ? friday.toJSDate() : now, to: sunday.toJSDate()};
}
const titles: Record<Mode, [MessageKey, MessageKey]> = {events: ['eventsTitle', 'eventsTitleAll'], today: ['todayTitle', 'todayTitleAll'],
  weekend: ['weekendTitle', 'weekendTitleAll'], search: ['searchTitle', 'searchTitle'], style: ['styleTitle', 'styleTitle']};
// Callback data is limited to 64 bytes; an argument that does not fit simply gets no "more" button.
const moreData = (mode: Mode, page: number, arg: string) => {
  const data = ['m', mode, page, arg].join('|');
  return Buffer.byteLength(data) <= 64 ? data : null;
};
type Chat = Pick<TelegramChat, 'chatId' | 'cityId' | 'locale' | 'notify' | 'userId'>;
export async function eventList(chat: Chat, mode: Mode, arg: string, page: number, now = new Date()): Promise<{html: string; buttons?: Button[][]}> {
  const locale = botLocale(chat.locale), city = chat.cityId ? (await allCities()).find(item => item.id === chat.cityId) : undefined;
  const filter: Prisma.EventWhereInput = city ? {cityId: city.id} : {};
  let label = arg;
  if (mode === 'search') filter.title = {contains: arg.slice(0, 100), mode: 'insensitive'};
  if (mode === 'style') {
    const style = fuzzyPick(await allStyles(), arg);
    if (!style) return {html: esc(t(locale, 'styleNotFound', {query: arg}))};
    filter.styles = {some: {styleId: {in: await styleDescendantIds(style.id)}}};
    label = style.name;
  }
  const {from, to} = range(mode, city?.timezone || 'UTC', now);
  const rows = await db.eventOccurrence.findMany({
    where: {...upcomingOccurrences(filter, from), startsAt: {gte: from, ...(to ? {lte: to} : {})}},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    select: {startsAt: true, event: {select: {slug: true, title: true, timezone: true, city: {select: {name: true}}, venue: {select: {name: true}}}}}});
  const heading = t(locale, titles[mode][city ? 0 : 1], {city: city ? cityName(city, locale) : '', query: arg, style: label}) + (page > 1 ? ' · ' + t(locale, 'page', {page}) : '');
  const lines = rows.slice(0, PAGE_SIZE).map(({startsAt, event}) => {
    const place = [event.venue?.name, city ? null : event.city.name].filter(Boolean).join(', ');
    return '<b>' + esc(event.title) + '</b>\n' + esc(when(startsAt, event.timezone, locale) + (place ? ' · ' + place : '')) + '\n'
      + link(siteUrl() + '/' + locale + '/events/' + encodeURIComponent(event.slug), t(locale, 'open'));
  });
  const hint = !city && (mode === 'events' || mode === 'today' || mode === 'weekend') && page === 1 ? '\n\n' + esc(t(locale, 'cityHint')) : '';
  const more = rows.length > PAGE_SIZE && page < MAX_PAGE ? moreData(mode, page + 1, mode === 'style' || mode === 'search' ? arg : '') : null;
  return {html: '<b>' + esc(heading) + '</b>\n\n' + (lines.length ? lines.join('\n\n') : esc(t(locale, 'noEvents'))) + hint,
    buttons: more ? [[{text: t(locale, 'more'), callback_data: more}]] : undefined};
}
// "/events 2" and "/search lindy hop 2": a trailing number is the page.
function paged(arg: string, textual: boolean): {arg: string; page: number} {
  const match = textual ? /^(.*\S)\s+(\d{1,2})$/.exec(arg) : /^(\d{1,2})$/.exec(arg);
  const page = match ? Number(match[textual ? 2 : 1]) : 1;
  return {arg: textual ? (match ? match[1] : arg) : '', page: Math.min(Math.max(page, 1), MAX_PAGE)};
}
async function command(chat: Chat, name: string, arg: string, isPrivate: boolean, now: Date): Promise<{html: string; buttons?: Button[][]} | string> {
  const locale = botLocale(chat.locale), say = (key: MessageKey, values?: Record<string, string | number>) => esc(t(locale, key, values));
  const update = (data: Prisma.TelegramChatUpdateInput) => db.telegramChat.update({where: {chatId: chat.chatId}, data});
  switch (name) {
    case 'start': {
      if (!arg) return say('start');
      if (!isPrivate) return say('linkPrivate');
      return await consumeLinkToken(arg, chat.chatId, now) ? say('linked') : say('linkInvalid');
    }
    case 'help': return say('help');
    case 'city': {
      const cities = await allCities();
      if (!arg) {
        const current = cities.find(city => city.id === chat.cityId);
        return current ? say('cityCurrent', {city: cityName(current, locale)}) : say('cityUsage');
      }
      const city: CityOption | null = fuzzyPick(cities, arg);
      if (!city) return say('cityNotFound', {query: arg.slice(0, 80)});
      await update({cityId: city.id});
      return say('citySet', {city: cityName(city, locale)});
    }
    case 'events': case 'today': case 'weekend': return eventList(chat, name, '', paged(arg, false).page, now);
    case 'search': case 'style': {
      const input = paged(arg, true);
      if (input.arg.length < 2) return say(name === 'search' ? 'searchUsage' : 'styleUsage');
      return eventList(chat, name, input.arg.slice(0, 80), input.page, now);
    }
    case 'lang': {
      const next = arg.toLowerCase();
      if (next !== 'en' && next !== 'es' && next !== 'ru') return say('langUsage');
      await update({locale: next});
      return esc(t(next, 'langSet'));
    }
    case 'notify': {
      const next = arg.toLowerCase();
      if (next !== 'on' && next !== 'off') return say('notifyUsage', {state: t(locale, chat.notify ? 'stateOn' : 'stateOff')});
      // Notifications are about an account's events and messages, so an unconnected chat has nothing to receive.
      if (next === 'on' && !chat.userId) return say('notifyNeedsLink');
      await update({notify: next === 'on'});
      return say(next === 'on' ? 'notifyOn' : 'notifyOff');
    }
    case 'stop': {
      await db.telegramChat.deleteMany({where: {chatId: chat.chatId}});
      return say('stopped');
    }
    default: return say('unknown');
  }
}
// Handles one webhook update. Returns what happened, mostly for tests and logs; never throws.
export async function handleUpdate(input: unknown, now = new Date()): Promise<'ignored' | 'limited' | 'answered' | 'failed'> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return 'ignored';
  const {message, callback_query: callback} = parsed.data, source = message?.chat ?? callback?.message?.chat;
  if (!source) return 'ignored';
  const chatId = String(source.id), isPrivate = (source.type ?? 'private') === 'private';
  try {
    let name: string, arg: string;
    if (callback) {
      // "m|<mode>|<page>|<argument>" from the "more" button. The answer stops the button's spinner whatever happens next.
      callApi('answerCallbackQuery', {callback_query_id: callback.id}).catch(() => undefined);
      const [tag, mode, page, ...rest] = (callback.data || '').split('|');
      if (tag !== 'm' || !modes.includes(mode as Mode) || !/^\d{1,2}$/.test(page)) return 'ignored';
      name = mode;
      arg = [rest.join('|'), page].filter(Boolean).join(' ');
    } else {
      // "/events@some_bot 2" in a group; plain text is not a command and is ignored.
      const match = /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec((message?.text || '').trim());
      if (!match) return 'ignored';
      name = match[1].toLowerCase();
      arg = (match[2] || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    if (!(await rateLimit('telegram:' + chatId, {limit: 30, windowSec: 60})).ok) return 'limited';
    const chat = await db.telegramChat.upsert({where: {chatId}, update: {}, create: {chatId, locale: botLocale(message?.from?.language_code?.slice(0, 2).toLowerCase())}});
    const reply = await command(chat, name, arg, isPrivate, now);
    await sendMessage(chatId, typeof reply === 'string' ? reply : reply.html, typeof reply === 'string' ? undefined : reply.buttons);
    return 'answered';
  } catch (error) {
    if (error instanceof TelegramError && error.gone) await db.telegramChat.updateMany({where: {chatId}, data: {notify: false}}).catch(() => undefined);
    console.error(JSON.stringify({level: 'error', event: 'telegram_update_failed', status: error instanceof TelegramError ? error.status : undefined,
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'}));
    return 'failed';
  }
}
