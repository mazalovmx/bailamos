import {db} from '@dance/db';
import {embedMeta} from '../media/dto';
import type {EmbedStore} from './instagram';
/**
 * Postgres side of the embed cache: the newest fetched copy among all MediaItems that embed the permalink.
 * Saving refreshes every such item, so one upstream answer serves all pages that show the post.
 */
export const dbEmbedStore: EmbedStore = {
  async find(permalink) {
    const row = await db.mediaItem.findFirst({
      where: {kind: 'instagram', sourceUrl: permalink, embedFetched: {not: null}},
      orderBy: {embedFetched: 'desc'}, select: {embedHtml: true, embedMeta: true, embedFetched: true}
    });
    if (!row?.embedFetched) return null;
    return {status: 'ok', meta: embedMeta(row.embedMeta), html: row.embedHtml || undefined, fetchedAt: row.embedFetched.getTime()};
  },
  async save(permalink, entry) {
    await db.mediaItem.updateMany({where: {kind: 'instagram', sourceUrl: permalink}, data: {
      embedHtml: entry.html ?? null, embedMeta: entry.meta, embedFetched: new Date(entry.fetchedAt)
    }});
  }
};
