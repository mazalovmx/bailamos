import type {MetadataRoute} from 'next';
import {sitemapEntries, sitemapFileCount} from '../lib/blog/sitemap';
import {siteUrl} from '../lib/mail';
// Read from the database on request, never at build time. Files are served as /sitemap/<n>.xml
// (there is no /sitemap.xml index); robots.ts lists every one of them.
export const dynamic = 'force-dynamic';
export async function generateSitemaps() {
  let files = 1;
  try {files = await sitemapFileCount();} catch {/* the database is not reachable: a single file is still announced */}
  return Array.from({length: files}, (_, id) => ({id}));
}
export default async function sitemap({id}: {id: number | string | Promise<number | string>}): Promise<MetadataRoute.Sitemap> {
  const file = Number(await id);
  return sitemapEntries(siteUrl(), Number.isInteger(file) && file >= 0 ? file : 0);
}
