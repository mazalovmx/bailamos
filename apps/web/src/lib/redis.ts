import Redis from 'ioredis';
// One lazily connected client per process. Redis is an optimisation everywhere it is used here (cache, rate limits),
// so every failure is swallowed and reported to the caller as `undefined`.
type State = {client?: Redis; url?: string; connecting?: Promise<void>; downUntil: number};
const holder = globalThis as unknown as {danceRedis?: State};
const state = holder.danceRedis ??= {downUntil: 0};
const PAUSE_MS = 10_000;
function client() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!state.client || state.url !== url) {
    state.client?.disconnect();
    state.url = url;
    state.connecting = undefined;
    state.client = new Redis(url, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1500, commandTimeout: 1500,
      retryStrategy: attempt => Math.min(attempt * 500, 15_000)
    });
    // Without a listener ioredis would print every reconnect error.
    state.client.on('error', () => {});
  }
  return state.client;
}
/**
 * Runs `run` against Redis. Resolves to `undefined` when Redis is not configured, unreachable or the command fails;
 * callbacks should therefore return `null` (not `undefined`) for "no value".
 */
export async function withRedis<T>(run: (redis: Redis) => Promise<T>): Promise<T | undefined> {
  const redis = client();
  if (!redis || Date.now() < state.downUntil) return undefined;
  try {
    if (redis.status === 'wait') state.connecting ??= redis.connect().finally(() => {state.connecting = undefined;});
    if (state.connecting) await state.connecting;
    if (redis.status !== 'ready') throw new Error('REDIS_NOT_READY');
    return await run(redis);
  } catch {
    // Skip Redis for a short while instead of paying the timeout on every request.
    state.downUntil = Date.now() + PAUSE_MS;
    return undefined;
  }
}
export const redisConfigured = () => !!process.env.REDIS_URL;
/** Closes the connection; used by tests and scripts so the process can exit. */
export async function closeRedis() {
  const redis = state.client;
  state.client = undefined; state.connecting = undefined; state.downUntil = 0;
  if (!redis) return;
  try {if (redis.status === 'ready') await redis.quit(); else redis.disconnect();} catch {redis.disconnect();}
}
