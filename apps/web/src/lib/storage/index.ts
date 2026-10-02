import {diskStorage} from './local';
import {s3Settings, s3Storage} from './s3';
import {readStream, type Storage} from './types';
export type {ListedObject, ListOptions, Presigned, PresignOptions, Storage, StoredObject} from './types';
export {assertKey, readStream, UPLOAD_TTL_SEC} from './types';
let cached: {signature: string; storage: Storage} | undefined;
/**
 * The configured object store. S3-compatible when S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are set
 * (MEDIA_STORAGE=local forces the disk driver even then); local disk otherwise.
 */
export function storage(): Storage {
  const settings = process.env.MEDIA_STORAGE === 'local' ? null : s3Settings();
  if (!settings) return diskStorage;
  const signature = JSON.stringify(settings);
  if (cached?.signature !== signature) cached = {signature, storage: s3Storage(settings)};
  return cached.storage;
}
/** Reads a whole object into memory. `null` = missing, `'TOO_LARGE'` = bigger than `maxBytes`. */
export async function readObject(key: string, maxBytes: number): Promise<Buffer | null | 'TOO_LARGE'> {
  const object = await storage().getObject(key);
  if (!object) return null;
  if (object.size !== undefined && object.size > maxBytes) {await object.body.cancel().catch(() => {}); return 'TOO_LARGE';}
  return await readStream(object.body, maxBytes) ?? 'TOO_LARGE';
}
