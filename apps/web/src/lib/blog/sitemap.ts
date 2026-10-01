import {db} from '@dance/db';
import {LOCALES, alternates, postPath} from './links';
import {publicEventWhere, publicPostWhere} from './posts';
// One entity (an event, a profile, a post…) is listed once per language, each entry naming the other languages.
// A sitemap file may hold 50 000 URLs, so a file carries at most 15 000 entities (45 000 URLs).
export const ENTITIES_PER_FILE = 15_000;
export type SitemapEntry = {url: string; lastModified?: Date; alternates: {languages: Record<string, string>}};
type Entity = {path: (locale: string) => string; lastModified?: Date};
type Section = {count: () => Promise<number>; page: (skip: number, take: number) => Promise<Entity[]>};
const STATIC = ['', '/events', '/calendar', '/map', '/cities', '/styles', '/privacy'];
// Stub profiles (no owner yet) are public pages too; hidden ones are not.
const profileWhere = {hiddenAt: null};
const sections: Section[] = [
  {count: async () => STATIC.length, page: async (skip, take) => STATIC.slice(skip, skip + take).map(path => ({path: locale => '/' + locale + path}))},
  {count: () => db.city.count(), page: async (skip, take) => (await db.city.findMany({orderBy: {slug: 'asc'}, skip, take, select: {slug: true}}))
    .map(city => ({path: locale => '/' + locale + '/cities/' + city.slug}))},
  {count: () => db.danceStyle.count(), page: async (skip, take) => (await db.danceStyle.findMany({orderBy: {slug: 'asc'}, skip, take, select: {slug: true}}))
    .map(style => ({path: locale => '/' + locale + '/styles/' + style.slug}))},
  {count: () => db.event.count({where: publicEventWhere}),
    page: async (skip, take) => (await db.event.findMany({where: publicEventWhere, orderBy: {id: 'asc'}, skip, take, select: {slug: true, updatedAt: true}}))
      .map(event => ({path: locale => '/' + locale + '/events/' + event.slug, lastModified: event.updatedAt}))},
  {count: () => db.profile.count({where: profileWhere}),
    page: async (skip, take) => (await db.profile.findMany({where: profileWhere, orderBy: {id: 'asc'}, skip, take, select: {handle: true, updatedAt: true}}))
      .map(profile => ({path: locale => '/' + locale + '/@' + profile.handle, lastModified: profile.updatedAt}))},
  {count: () => db.post.count({where: {...publicPostWhere, slug: {not: null}}}),
    page: async (skip, take) => (await db.post.findMany({where: {...publicPostWhere, slug: {not: null}}, orderBy: {id: 'asc'}, skip, take,
      select: {slug: true, updatedAt: true, profile: {select: {handle: true}}}}))
      .map(post => ({path: locale => postPath(locale, post.profile.handle, post.slug!), lastModified: post.updatedAt}))}
];
export async function sitemapFileCount() {
  const counts = await Promise.all(sections.map(section => section.count()));
  return Math.max(1, Math.ceil(counts.reduce((sum, count) => sum + count, 0) / ENTITIES_PER_FILE));
}
/** Entries of one sitemap file. Sections follow each other; only the slice that falls into this file is queried. */
export async function sitemapEntries(origin: string, file = 0, perFile = ENTITIES_PER_FILE): Promise<SitemapEntry[]> {
  const counts = await Promise.all(sections.map(section => section.count()));
  const entities: Entity[] = [];
  let offset = Math.max(0, Math.floor(file)) * perFile, room = perFile;
  for (let i = 0; i < sections.length && room > 0; i++) {
    if (offset >= counts[i]) {offset -= counts[i]; continue;}
    const rows = await sections[i].page(offset, room);
    entities.push(...rows); room -= rows.length; offset = 0;
  }
  return entities.flatMap(entity => {
    const languages = alternates(origin, entity.path);
    return LOCALES.map(locale => ({url: origin + entity.path(locale), ...(entity.lastModified ? {lastModified: entity.lastModified} : {}), alternates: {languages}}));
  });
}
