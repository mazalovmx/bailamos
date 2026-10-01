import {cookies} from 'next/headers';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import ru from '../../messages/ru.json';
import {locales, translator, type Locale} from './format';
const catalogues: Record<Locale, Record<string, string>> = {en, es, ru};
export const localeCookie = 'admin_locale';
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(localeCookie)?.value;
  return locales.find(locale => locale === value) ?? 'en';
}
export const messagesFor = (locale: Locale) => catalogues[locale];
export const getT = async () => translator(messagesFor(await getLocale()));
