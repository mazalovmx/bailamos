import {createHash, timingSafeEqual} from 'node:crypto';
const digest = (value: string) => createHash('sha256').update(value).digest();
// 'OFF' when no CRON_SECRET is configured (the endpoint then does not exist), otherwise a constant-time bearer check.
export function cronAccess(authorization: string | null | undefined): 'OFF' | 'DENIED' | 'OK' {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return 'OFF';
  const given = /^Bearer (.+)$/.exec(authorization || '')?.[1] ?? '';
  // Hashing first gives both buffers the same length whatever was sent.
  return timingSafeEqual(digest(given), digest(secret)) && given.length > 0 ? 'OK' : 'DENIED';
}
