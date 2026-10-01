import type {MetadataRoute} from 'next';
import {sitemapFileCount} from '../lib/blog/sitemap';
import {siteUrl} from '../lib/mail';
export const dynamic = 'force-dynamic';
const PRIVATE = ['/settings', '/messages', '/profile', '/onboarding', '/my-events', '/posts', '/feed', '/invites/', '/login', '/register',
  '/forgot-password', '/reset-password', '/events/new', '/venues/new', '/partners', '/notifications', '/unsubscribe'];
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = siteUrl();
  let files = 1;
  try {files = await sitemapFileCount();} catch {/* keep the first file */}
  return {
    rules: [{userAgent: '*', allow: '/', disallow: ['/api/', ...['en', 'es', 'ru'].flatMap(locale => PRIVATE.map(path => '/' + locale + path)),
      // Edit screens of events and posts, in every language.
      '/*/edit$', '/*/edit?']}],
    sitemap: Array.from({length: files}, (_, id) => origin + '/sitemap/' + id + '.xml')
  };
}
