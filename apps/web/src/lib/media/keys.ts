// Pure helpers shared by server and client code. No environment access and no Node imports here.
export const WIDTHS = [320, 800, 1600] as const;
export const FORMATS = ['avif', 'webp'] as const;
export type Width = typeof WIDTHS[number];
export type Format = typeof FORMATS[number];
export const TARGETS = ['event', 'post', 'avatar', 'cover'] as const;
export type UploadTarget = typeof TARGETS[number];
const ID = '[A-Za-z0-9_-]{1,64}';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RAW = new RegExp('^raw/(' + ID + ')/(event|post|avatar|cover)/(' + ID + ')/(' + UUID + ')$');
const BASE = new RegExp('^img/(' + ID + ')/(' + UUID + ')$');
const VARIANT = new RegExp('^(img/' + ID + '/' + UUID + ')/(320|800|1600)\\.(avif|webp)$');
/**
 * A raw upload key names its uploader and its target, so completing an upload needs no server-side state:
 * the profile segment must match the signed-in profile and the target is authorised again on completion.
 */
export const rawKey = (profileId: string, target: UploadTarget, targetId: string | undefined, uuid: string) =>
  ['raw', profileId, target, targetId || '_', uuid].join('/');
export function parseRawKey(key: string) {
  const match = RAW.exec(key);
  if (!match) return null;
  return {profileId: match[1], target: match[2] as UploadTarget, targetId: match[3] === '_' ? undefined : match[3], uuid: match[4]};
}
/** The value stored in MediaItem.storageKey / Profile.avatarKey / Profile.coverKey. */
export const baseKey = (profileId: string, uuid: string) => 'img/' + profileId + '/' + uuid;
export const isBaseKey = (key: string) => BASE.test(key);
export const variantKey = (base: string, width: Width, format: Format) => base + '/' + width + '.' + format;
export const variantKeys = (base: string) => WIDTHS.flatMap(width => FORMATS.map(format => variantKey(base, width, format)));
export function parseVariantKey(key: string) {
  const match = VARIANT.exec(key);
  return match ? {base: match[1], width: Number(match[2]) as Width, format: match[3] as Format} : null;
}
export const contentTypes: Record<Format, string> = {avif: 'image/avif', webp: 'image/webp'};
