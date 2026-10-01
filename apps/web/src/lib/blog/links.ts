// Addresses of blog pages. Pure: the origin is passed in (siteUrl() on the server).
export const LOCALES = ['en', 'es', 'ru'] as const;
export const DEFAULT_LOCALE = 'en';
export const blogLocale = (value?: string | null) => value === 'es' || value === 'ru' ? value : DEFAULT_LOCALE;
export const postPath = (locale: string, handle: string, slug: string) => '/' + locale + '/people/' + handle + '/posts/' + slug;
export const postsPath = (locale: string, handle: string) => '/' + locale + '/people/' + handle + '/posts';
export const rssPath = (handle: string, locale?: string) => '/api/feeds/rss/' + handle + (locale && locale !== DEFAULT_LOCALE ? '?locale=' + locale : '');
/** hreflang map for a path that exists under every locale; the default locale doubles as x-default. */
export function alternates(origin: string, path: (locale: string) => string) {
  return {...Object.fromEntries(LOCALES.map(locale => [locale, origin + path(locale)])), 'x-default': origin + path(DEFAULT_LOCALE)} as Record<string, string>;
}
/** Media URLs are absolute when a CDN is configured and site-relative otherwise. */
export const absoluteUrl = (origin: string, url: string) => /^https?:\/\//.test(url) ? url : origin + url;
