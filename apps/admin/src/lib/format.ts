export const locales = ['en', 'es', 'ru'] as const;
export type Locale = typeof locales[number];
export type Translate = (key: string, vars?: Record<string, string | number>) => string;
// Flat catalogues with {placeholder} substitution; a missing key falls back to the key itself so nothing renders blank.
export const translator = (messages: Record<string, string>): Translate => (key, vars) => {
  const template = messages[key] ?? key;
  return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? '')) : template;
};
