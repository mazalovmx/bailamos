import {randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {z} from 'zod';
import {readObject, storage} from '../storage';
import {authorizeTarget, profileOf, type MediaUser} from './access';
import {allowedMimes, maxBytes, maxItemsPerParent} from './config';
import {toMediaDto, type MediaDto} from './dto';
import {MediaError} from './errors';
import {TARGETS, baseKey, isBaseKey, parseRawKey, rawKey, variantKey, variantKeys} from './keys';
import {processImage} from './process';
import {mediaUrl} from './url';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const startSchema = z.object({
  target: z.enum(TARGETS), targetId: id.optional(), mime: z.string().max(100), size: z.number().int().positive()
});
export const completeSchema = z.object({key: z.string().max(300), alt: z.string().trim().max(300).optional()});
export const altSchema = z.string().trim().max(300);
export type Uploaded = {id?: string; key: string; url: string; item?: MediaDto};
export async function assertRoom(parent: {eventId?: string; postId?: string}) {
  if (!parent.eventId && !parent.postId) return;
  if (await db.mediaItem.count({where: parent}) >= maxItemsPerParent()) throw new MediaError('MEDIA_LIMIT', 400);
}
/** Step 1: authorise, check the declared type and size, and hand out a one-object upload URL. */
export async function startUpload(user: MediaUser, input: unknown) {
  const {target, targetId, mime, size} = startSchema.parse(input);
  const profileId = profileOf(user);
  if (!allowedMimes().includes(mime.toLowerCase())) throw new MediaError('MEDIA_TYPE', 415);
  if (size > maxBytes()) throw new MediaError('MEDIA_TOO_LARGE', 413);
  await assertRoom(await authorizeTarget(user, target, targetId));
  const key = rawKey(profileId, target, target === 'event' || target === 'post' ? targetId : undefined, randomUUID());
  const presigned = await storage().presignUpload(key, {mime: mime.toLowerCase(), size});
  return {key, uploadUrl: presigned.url, method: presigned.method, headers: presigned.headers, expiresAt: presigned.expiresAt};
}
/**
 * Step 2: the raw object is read back, verified and re-encoded; only the derivatives are kept.
 * The key carries the uploader's profile id, so another user's key is refused before storage is touched,
 * and the target is authorised again because rights may have changed since step 1.
 */
export async function completeUpload(user: MediaUser, input: unknown): Promise<Uploaded> {
  const {key, alt} = completeSchema.parse(input);
  const profileId = profileOf(user), raw = parseRawKey(key);
  if (!raw) throw new MediaError('INVALID_INPUT', 400);
  if (raw.profileId !== profileId) throw new MediaError('FORBIDDEN', 403);
  const parent = await authorizeTarget(user, raw.target, raw.targetId);
  await assertRoom(parent);
  const store = storage();
  const body = await readObject(key, maxBytes());
  if (!body) throw new MediaError('UPLOAD_NOT_FOUND', 404);
  if (body === 'TOO_LARGE') {
    await store.deleteObjects([key]).catch(() => {});
    throw new MediaError('MEDIA_TOO_LARGE', 413);
  }
  // Whatever happens next, the unverified original must not stay in storage.
  const processed = await processImage(body).finally(() => store.deleteObjects([key]).catch(() => {}));
  const base = baseKey(profileId, raw.uuid);
  try {
    for (const file of processed.files) await store.putObject(variantKey(base, file.width, file.format), file.body, file.contentType);
    if (raw.target === 'avatar' || raw.target === 'cover') {
      const field = raw.target === 'avatar' ? 'avatarKey' : 'coverKey';
      const previous = (await db.profile.findUnique({where: {id: profileId}, select: {avatarKey: true, coverKey: true}}))?.[field];
      await db.profile.update({where: {id: profileId}, data: {[field]: base}});
      if (previous && previous !== base && isBaseKey(previous)) await store.deleteObjects(variantKeys(previous)).catch(() => {});
      return {key: base, url: mediaUrl(base)};
    }
    const item = await db.mediaItem.create({data: {
      ...parent, kind: 'upload', storageKey: base, uploaderProfileId: profileId, mime: 'image/webp',
      size: processed.bytes, width: processed.width, height: processed.height, alt: alt || null,
      position: await db.mediaItem.count({where: parent})
    }});
    const dto = toMediaDto(item);
    return {id: item.id, key: base, url: dto.url as string, item: dto};
  } catch (error) {
    await store.deleteObjects(variantKeys(base)).catch(() => {});
    throw error;
  }
}
