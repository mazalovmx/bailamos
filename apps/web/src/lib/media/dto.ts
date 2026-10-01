import {variants, type Variants} from './url';
// Serializable shape shared by the items API, the server gallery and the client manager.
export type EmbedMeta = {author?: string; title?: string; thumbnailUrl?: string};
export type MediaDto = {
  id: string; kind: 'upload' | 'instagram'; alt: string | null;
  key?: string; url?: string; sources?: Variants; width?: number | null; height?: number | null;
  permalink?: string; meta?: EmbedMeta
};
type Row = {
  id: string; kind: string; alt: string | null; storageKey: string | null; width: number | null; height: number | null;
  sourceUrl: string | null; embedMeta: unknown
};
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
/** Reads cached oEmbed fields defensively: the column is free-form JSON. */
export function embedMeta(value: unknown): EmbedMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const thumbnailUrl = text(raw.thumbnailUrl, 2000);
  return {author: text(raw.author, 100), title: text(raw.title, 500), thumbnailUrl: thumbnailUrl?.startsWith('https://') ? thumbnailUrl : undefined};
}
export function toMediaDto(row: Row): MediaDto {
  if (row.kind === 'instagram' || !row.storageKey)
    return {id: row.id, kind: 'instagram', alt: row.alt, permalink: row.sourceUrl || '', meta: embedMeta(row.embedMeta)};
  const sources = variants(row.storageKey, row.width);
  return {id: row.id, kind: 'upload', alt: row.alt, key: row.storageKey, url: sources.src, sources, width: row.width, height: row.height};
}
