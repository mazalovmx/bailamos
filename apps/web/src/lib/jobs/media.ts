import {readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {ListObjectsV2Command, S3Client} from '@aws-sdk/client-s3';
import type {JobDef} from '../../worker/types';
import {storage} from '../storage';
import {localRoot} from '../storage/local';
import {s3Settings} from '../storage/s3';
import {parseRawKey} from '../media/keys';
export const RAW_MAX_AGE_MS = 24 * 3600_000, SWEEP_LIMIT = 5000;
type Listed = {key: string; modified: Date};
// The Storage interface has no listing call, so each driver is listed here; removal goes through the interface.
async function listLocal(prefix: string, limit: number): Promise<Listed[]> {
  const found: Listed[] = [];
  async function walk(directory: string, key: string) {
    for (const item of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
      if (found.length >= limit) return;
      const path = join(directory, item.name), name = key + item.name;
      if (item.isDirectory()) await walk(path, name + '/');
      else if (item.isFile()) {
        const info = await stat(path).catch(() => null);
        if (info) found.push({key: name, modified: info.mtime});
      }
    }
  }
  await walk(join(localRoot(), ...prefix.split('/').filter(Boolean)), prefix);
  return found;
}
async function listS3(prefix: string, limit: number): Promise<Listed[] | null> {
  const settings = s3Settings();
  if (!settings) return null;
  const client = new S3Client({region: settings.region, endpoint: settings.endpoint, forcePathStyle: settings.forcePathStyle,
    credentials: {accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey}});
  const found: Listed[] = [];
  try {
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({Bucket: settings.bucket, Prefix: prefix, ContinuationToken: token}));
      for (const object of page.Contents || []) if (object.Key && object.LastModified) found.push({key: object.Key, modified: object.LastModified});
      token = page.IsTruncated && found.length < limit ? page.NextContinuationToken : undefined;
    } while (token);
  } finally {client.destroy();}
  return found;
}
/**
 * Deletes raw uploads that were never completed. A finished upload removes its own raw object within seconds, so
 * anything older than a day under "raw/" is abandoned. Only well-formed raw keys are touched.
 */
export async function sweepRawUploads(now = new Date(), maxAgeMs = RAW_MAX_AGE_MS) {
  const store = storage(), listed = store.driver === 'local' ? await listLocal('raw/', SWEEP_LIMIT) : store.driver === 's3' ? await listS3('raw/', SWEEP_LIMIT) : null;
  if (!listed) return {driver: store.driver, skipped: 'UNSUPPORTED' as const, scanned: 0, deleted: 0};
  const stale = listed.filter(item => parseRawKey(item.key) && now.getTime() - item.modified.getTime() > maxAgeMs).map(item => item.key);
  if (stale.length) await store.deleteObjects(stale);
  return {driver: store.driver, scanned: listed.length, deleted: stale.length};
}
export const mediaJobs: JobDef[] = [
  {name: 'media.sweep', cron: '15 4 * * *', attempts: 2, handler: () => sweepRawUploads()}
];
