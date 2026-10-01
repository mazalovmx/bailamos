import en from '../../../messages/features/Notifications/en.json';
import es from '../../../messages/features/Notifications/es.json';
import ru from '../../../messages/features/Notifications/ru.json';
export type NoteLocale = 'en' | 'es' | 'ru';
type Catalogue = Record<string, string>;
const catalogues: Record<NoteLocale, Catalogue> = {en, es, ru};
export const noteLocale = (value?: string | null): NoteLocale => value === 'es' || value === 'ru' ? value : 'en';
// Push payloads and emails are written outside a request, in the recipient's language, straight from the
// Notifications catalogue. Only plain "{name}" placeholders are used in the keys read here.
export function noteText(locale: NoteLocale, key: string, values: Record<string, string> = {}) {
  const template = catalogues[locale][key] ?? catalogues.en[key] ?? '';
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}
const has = (locale: NoteLocale, key: string) => typeof catalogues[locale][key] === 'string';
// Stored data comes from many writers and old versions: read every field defensively.
function field(data: unknown, ...names: string[]) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  for (const name of names) {
    const value = (data as Record<string, unknown>)[name];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ').slice(0, 160);
  }
  return '';
}
function moment(value: string, zone: string, locale: NoteLocale, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  try {return new Intl.DateTimeFormat(locale, {...options, timeZone: zone || 'UTC'}).format(date);}
  catch {return new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'}).format(date);}
}
export type RenderedNotification = {title: string; body: string};
export function renderNotification(localeValue: string | null | undefined, type: string, data: unknown): RenderedNotification {
  const locale = noteLocale(localeValue), known = /^[A-Z_]{1,40}$/.test(type) && has(locale, 'type_' + type);
  if (!known) return {title: noteText(locale, 'type_UNKNOWN'), body: noteText(locale, 'body_UNKNOWN')};
  const zone = field(data, 'timezone');
  const values = {
    title: field(data, 'title', 'eventTitle') || noteText(locale, 'fallback_title'),
    name: field(data, 'name', 'inviter', 'inviterName', 'followerName', 'senderName', 'fromName') || noteText(locale, 'fallback_name'),
    profile: field(data, 'name', 'handle') || noteText(locale, 'fallback_name'),
    place: field(data, 'place', 'venue'),
    time: moment(field(data, 'startsAt', 'date'), zone, locale, {hour: '2-digit', minute: '2-digit', timeZoneName: 'short'}),
    date: moment(field(data, 'date', 'startsAt'), zone, locale, {dateStyle: 'medium', timeStyle: 'short'})
  };
  let key = 'body_' + type;
  if (type === 'EVENT_REMINDER' && values.place) key += '_PLACE';
  if (type === 'EVENT_CANCELLED' && field(data, 'date')) key += '_DATE';
  if (type === 'CLAIM_DECIDED' && has(locale, key + '_' + field(data, 'status'))) key += '_' + field(data, 'status');
  let body = has(locale, key) ? noteText(locale, key, values) : '';
  // Free text written by a person replaces or extends the stock sentence.
  if (type === 'CHAT_MESSAGE') body = field(data, 'preview', 'text', 'body') || body;
  // A new post of a followed profile: the heading names the author, the body is the title of the post.
  if (type === 'NEW_POST') body = field(data, 'title');
  if (type === 'MODERATION') body = field(data, 'note', 'reason', 'message') || body;
  if (type === 'CLAIM_DECIDED' && field(data, 'reason')) body += ' ' + field(data, 'reason');
  if (type === 'EVENT_REMINDER' && !values.time) body = values.place;
  return {title: noteText(locale, 'type_' + type, values), body};
}
// Links are stored with or without a locale prefix; they always open in the reader's language.
// Anything that is not a plain same-site path is dropped.
export function localizeUrl(url: string | null | undefined, localeValue?: string | null) {
  if (!url || !/^\/(?![/\\])/.test(url) || /[\\\s]/.test(url)) return null;
  const rest = url.replace(/^\/(en|es|ru)(?=\/|\?|#|$)/, '');
  return '/' + noteLocale(localeValue) + (rest.startsWith('/') || !rest ? rest : '/' + rest);
}
