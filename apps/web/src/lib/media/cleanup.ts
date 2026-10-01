import {db} from '@dance/db';
import {storage} from '../storage';
import {isBaseKey, variantKeys} from './keys';
const objects = (keys: (string | null | undefined)[]) => keys.flatMap(key => key && isBaseKey(key) ? variantKeys(key) : []);
/**
 * Deletes one media item and its stored files. The row goes first: a failed file removal leaves an unreachable
 * object, never a gallery entry pointing at nothing. Resolves to false when the item does not exist.
 */
export async function deleteMediaItem(id: string) {
  const item = await db.mediaItem.findUnique({where: {id}, select: {storageKey: true}});
  if (!item) return false;
  await db.mediaItem.delete({where: {id}});
  const keys = objects([item.storageKey]);
  if (keys.length) await storage().deleteObjects(keys);
  return true;
}
/**
 * Account deletion: removes every file the profile uploaded (event photos, post photos, avatar, cover, unfinished
 * uploads) together with the MediaItem rows that referenced them, and clears avatarKey/coverKey.
 * Instagram embeds added by the profile to its own posts disappear with the posts (cascade); nothing of theirs is stored.
 * Call it while the profile row still exists. Storage errors propagate so the caller can report an incomplete cleanup.
 */
export async function deleteProfileMedia(profileId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(profileId)) throw new Error('INVALID_PROFILE_ID');
  const where = {kind: 'upload', OR: [{uploaderProfileId: profileId}, {post: {profileId}}]};
  const [items, profile] = await Promise.all([
    db.mediaItem.findMany({where, select: {storageKey: true}}),
    db.profile.findUnique({where: {id: profileId}, select: {avatarKey: true, coverKey: true}})
  ]);
  const deleted = await db.mediaItem.deleteMany({where});
  if (profile?.avatarKey || profile?.coverKey) await db.profile.update({where: {id: profileId}, data: {avatarKey: null, coverKey: null}});
  const store = storage();
  // Everything a profile uploads lives under its own prefixes; the explicit list also covers keys from elsewhere.
  await store.deletePrefix('img/' + profileId + '/');
  await store.deletePrefix('raw/' + profileId + '/');
  const others = objects([...items.map(item => item.storageKey), profile?.avatarKey, profile?.coverKey])
    .filter(key => !key.startsWith('img/' + profileId + '/'));
  if (others.length) await store.deleteObjects(others);
  return {items: deleted.count};
}
