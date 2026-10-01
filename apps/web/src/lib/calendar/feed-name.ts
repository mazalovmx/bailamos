import en from '../../../messages/features/Calendar/en.json';
import es from '../../../messages/features/Calendar/es.json';
import ru from '../../../messages/features/Calendar/ru.json';
// Route handlers under /api have no locale segment, so the calendar name is read from the namespace files directly.
const text = {en, es, ru};
export type FeedLocale = keyof typeof text;
export function feedLocale(value: string | null): FeedLocale { return value === 'es' || value === 'ru' ? value : 'en'; }
export function feedName(locale: FeedLocale, names: string[]) { return [text[locale].feedName, ...names].join(' · '); }
