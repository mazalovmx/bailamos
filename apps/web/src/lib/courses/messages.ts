import en from '../../../messages/features/Courses/en.json';
import es from '../../../messages/features/Courses/es.json';
import ru from '../../../messages/features/Courses/ru.json';
import appEn from '../../../messages/app/en.json';
import appEs from '../../../messages/app/es.json';
import appRu from '../../../messages/app/ru.json';
export type CourseLocale = 'en' | 'es' | 'ru';
type Catalogue = Record<string, string>;
const catalogues: Record<CourseLocale, Catalogue> = {en, es, ru}, app: Record<CourseLocale, Catalogue> = {en: appEn, es: appEs, ru: appRu};
export const courseLocale = (value?: string | null): CourseLocale => value === 'es' || value === 'ru' ? value : 'en';
// Emails are written by the worker, outside any request, in the recipient's language: the catalogues are read directly.
// Only plain "{name}" placeholders are used in the keys read here (the "digest…" keys), never ICU plurals.
export function courseText(locale: CourseLocale, key: string, values: Record<string, string | number> = {}) {
  const template = catalogues[locale][key] ?? catalogues.en[key] ?? '';
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
/** Shared labels from the App catalogue ("kind_CLASS", "level_BEGINNER"); empty when the key does not exist. */
export const appLabel = (locale: CourseLocale, key: string) => app[locale][key] ?? app.en[key] ?? '';
