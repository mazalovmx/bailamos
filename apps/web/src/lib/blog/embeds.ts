import {db} from '@dance/db';
import {lookupEmbed, type EmbedDeps, type EmbedMeta} from '../embeds/instagram';
import {dbEmbedStore} from '../embeds/store';
import {embedMeta} from '../media/dto';
import {embedsOf} from './nodes';
// Instagram blocks of a post are mirrored as MediaItem rows (kind 'instagram', one per permalink). The rows are what
// the long-lived embed cache in Postgres consists of, so a post keeps its cards while Meta is unreachable.
export const MAX_POST_EMBEDS = 20;
const DAY_MS = 86_400_000;
/**
 * Makes the rows match the body: a row for every embedded permalink, none for a removed block. The card data comes
 * from the embed cache (Redis → stored copy → Meta), never from the request, so a body cannot plant a fake card.
 * A lookup that fails still creates the row — without data, which renders as a plain link.
 */
export async function syncPostEmbeds(postId: string, doc: unknown, uploaderProfileId?: string | null, deps: EmbedDeps = {}) {
  const wanted = embedsOf(doc).slice(0, MAX_POST_EMBEDS);
  const rows = await db.mediaItem.findMany({where: {postId, kind: 'instagram'}, orderBy: {createdAt: 'asc'}, select: {id: true, sourceUrl: true}});
  if (!wanted.length && !rows.length) return {created: 0, removed: 0};
  const kept = new Set<string>(), surplus: string[] = [];
  // Rows of removed blocks go, and so do duplicates left by two saves that raced.
  for (const row of rows) {
    if (row.sourceUrl && wanted.includes(row.sourceUrl) && !kept.has(row.sourceUrl)) kept.add(row.sourceUrl); else surplus.push(row.id);
  }
  if (surplus.length) await db.mediaItem.deleteMany({where: {id: {in: surplus}}});
  const missing = wanted.filter(permalink => !kept.has(permalink));
  if (!missing.length) return {created: 0, removed: surplus.length};
  const store = deps.store ?? dbEmbedStore;
  const entries = await Promise.all(missing.map(async permalink => {
    const found = await lookupEmbed(permalink, {...deps, store}).then(result => result.entry, () => null);
    return found?.status === 'ok' ? found : null;
  }));
  const position = await db.mediaItem.count({where: {postId}});
  await db.mediaItem.createMany({data: missing.map((permalink, index) => {
    const entry = entries[index];
    return {postId, kind: 'instagram', sourceUrl: permalink, uploaderProfileId: uploaderProfileId ?? null, position: position + index,
      ...(entry ? {embedHtml: entry.html ?? null, embedMeta: entry.meta, embedFetched: new Date(entry.fetchedAt)} : {})};
  })});
  return {created: missing.length, removed: surplus.length};
}
type Row = {kind: string; sourceUrl: string | null; embedMeta: unknown; embedFetched: Date | null; hiddenAt: Date | null};
/**
 * What a page needs from the embed rows of a post: the stored card data by permalink, the permalinks hidden by
 * moderation, and the permalinks whose copy is older than a day (worth asking Meta again).
 */
export function readEmbeds(rows: Row[], now = Date.now()) {
  const embeds = new Map<string, EmbedMeta>(), hidden = new Set<string>(), stale: string[] = [];
  for (const row of rows) {
    if (row.kind !== 'instagram' || !row.sourceUrl) continue;
    if (row.hiddenAt) {hidden.add(row.sourceUrl); continue;}
    if (row.embedFetched) embeds.set(row.sourceUrl, embedMeta(row.embedMeta));
    if (!row.embedFetched || now - row.embedFetched.getTime() > DAY_MS) stale.push(row.sourceUrl);
  }
  return {embeds, hidden, stale};
}
/**
 * Refreshes old copies in the background. A successful answer updates every row of the permalink (dbEmbedStore.save);
 * a failed one changes nothing, and the embed cache remembers the failure so Meta is not asked on every view.
 */
export function refreshEmbeds(permalinks: string[], deps: EmbedDeps = {}) {
  return Promise.all(permalinks.slice(0, 5).map(permalink => lookupEmbed(permalink, deps).catch(() => null)));
}
