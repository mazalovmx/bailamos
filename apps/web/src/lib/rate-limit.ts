import {withRedis} from './redis';
export type RateLimitOptions = {limit: number; windowSec: number};
export type RateLimitResult = {ok: boolean; retryAfter: number};
// Fixed window counter. INCR and EXPIRE run in one script so a crash cannot leave a counter without a TTL.
const SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('TTL', KEYS[1])
if t < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end
return {c, t}`;
const memory = new Map<string, {count: number; resetAt: number}>();
function inMemory(key: string, windowSec: number, now: number) {
  if (memory.size > 5000) for (const [name, entry] of memory) if (entry.resetAt <= now) memory.delete(name);
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) memory.set(key, entry = {count: 0, resetAt: now + windowSec * 1000});
  entry.count++;
  return {count: entry.count, ttl: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))};
}
/**
 * Counts one hit for `key` and tells whether it is still within `limit` per `windowSec`.
 * Uses Redis when available; otherwise a per-process counter, which still stops a single client hammering one instance.
 * Usage: `const {ok, retryAfter} = await rateLimit('chat:' + userId, {limit: 30, windowSec: 60});`
 */
export async function rateLimit(key: string, {limit, windowSec}: RateLimitOptions): Promise<RateLimitResult> {
  const name = 'rl:' + key;
  const shared = await withRedis(async redis => {
    const [count, ttl] = await redis.eval(SCRIPT, 1, name, String(windowSec)) as [number, number];
    return {count: Number(count), ttl: Number(ttl)};
  });
  const {count, ttl} = shared ?? inMemory(name, windowSec, Date.now());
  return count <= limit ? {ok: true, retryAfter: 0} : {ok: false, retryAfter: Math.max(1, ttl)};
}
/**
 * Client address for per-IP limits. Only meaningful behind a proxy that overwrites these headers (Railway, Coolify/Traefik);
 * a direct connection can spoof them, which is why per-IP limits are always paired with a per-user limit.
 */
export function clientIp(request: Request) {
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || '';
  return ip.trim().slice(0, 64) || 'unknown';
}
/** Test helper: forgets the in-memory counters. */
export const resetMemoryRateLimits = () => memory.clear();
