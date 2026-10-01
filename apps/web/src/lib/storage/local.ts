import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {mkdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {Readable} from 'node:stream';
import {assertKey, UPLOAD_TTL_SEC, type PresignOptions, type Storage} from './types';
// Development driver: objects are files under MEDIA_LOCAL_DIR and the "presigned URL" is a same-origin,
// HMAC-signed PUT /api/media/local/<key> link. It also works in production on a single node with a persistent volume.
const types: Record<string, string> = {avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png'};
function repoRoot() {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
export const localRoot = () => process.env.MEDIA_LOCAL_DIR ? resolve(process.env.MEDIA_LOCAL_DIR) : join(repoRoot(), '.data', 'media');
function file(key: string) {
  const root = localRoot(), path = resolve(root, assertKey(key));
  if (path !== root && !path.startsWith(root + sep)) throw new Error('INVALID_STORAGE_KEY');
  return path;
}
let ephemeral: string | undefined;
function secret() {
  const configured = process.env.MEDIA_SIGNING_SECRET || process.env.BETTER_AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('MEDIA_SIGNING_SECRET is required for local media storage');
  return ephemeral ??= randomBytes(32).toString('hex');
}
const sign = (key: string, exp: number, size: number, mime: string) =>
  createHmac('sha256', secret()).update(['media-upload', key, exp, size, mime].join('\n')).digest('base64url');
export function signLocalUpload(key: string, {mime, size, expiresSec = UPLOAD_TTL_SEC}: PresignOptions, now = Date.now()) {
  const exp = Math.floor(now / 1000) + expiresSec;
  const query = new URLSearchParams({exp: String(exp), size: String(size), mime, sig: sign(assertKey(key), exp, size, mime)});
  return {url: '/api/media/local/' + key + '?' + query, expiresAt: exp * 1000};
}
/** Returns the size and type the URL was issued for, or null when the signature is wrong, altered or expired. */
export function verifyLocalUpload(key: string, query: URLSearchParams, now = Date.now()) {
  const exp = Number(query.get('exp')), size = Number(query.get('size')), mime = query.get('mime') || '', sig = query.get('sig') || '';
  if (!Number.isSafeInteger(exp) || !Number.isSafeInteger(size) || size <= 0 || !mime) return null;
  let expected: Buffer;
  try {expected = Buffer.from(sign(key, exp, size, mime));} catch {return null;}
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (exp * 1000 < now) return null;
  return {size, mime};
}
export const diskStorage: Storage = {
  driver: 'local',
  async presignUpload(key, options) {
    const {url, expiresAt} = signLocalUpload(key, options);
    return {url, method: 'PUT', headers: {'Content-Type': options.mime}, expiresAt};
  },
  async getObject(key) {
    const path = file(key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    return {
      body: Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>,
      size: info.size, contentType: types[key.split('.').pop() || '']
    };
  },
  async putObject(key, body) {
    const path = file(key), temporary = path + '.' + randomUUID() + '.tmp';
    await mkdir(dirname(path), {recursive: true});
    // Write-then-rename keeps a half-written file from ever being served.
    await writeFile(temporary, body);
    await rename(temporary, path);
  },
  async deleteObjects(keys) {
    await Promise.all(keys.map(key => rm(file(key), {force: true})));
  },
  async deletePrefix(prefix) {
    if (!prefix.endsWith('/')) throw new Error('INVALID_STORAGE_KEY');
    await rm(file(prefix), {recursive: true, force: true});
  },
  async exists(key) {
    return !!(await stat(file(key)).catch(() => null))?.isFile();
  }
};
