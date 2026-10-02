// City.names holds {en, es, ru}; City.name is the local spelling and the fallback. Pure module: safe in client components.
export const cityLocales = ['en', 'es', 'ru'] as const;
export type CityLocale = typeof cityLocales[number];
export type NamedCity = {name: string; names?: unknown; localName?: string};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
// The city name in the interface language; an unknown locale or a missing translation yields the local spelling.
export function cityName(city: NamedCity, locale: string): string {
  return text(record(city.names)?.[locale.slice(0, 2).toLowerCase()]) || city.name;
}
// Every spelling a city can be found by: the shown name, the local one, then the translations, without repeats.
export function cityAliases(city: NamedCity): string[] {
  return [...new Set([city.name, ...(city.localName ? [city.localName] : []), ...Object.values(record(city.names) || {}).flatMap(value => text(value) || [])])];
}
export const cityLocale = (value: string | null | undefined): CityLocale | null => cityLocales.find(locale => locale === value) || null;
// Replaces `name` with the localized one and keeps the local spelling as `localName`; sorted for the reader's alphabet.
export function localizeCities<T extends NamedCity>(cities: readonly T[], locale: string): (T & {localName: string})[] {
  return cities.map(city => ({...city, name: cityName(city, locale), localName: city.name})).sort((a, b) => a.name.localeCompare(b.name, locale));
}
