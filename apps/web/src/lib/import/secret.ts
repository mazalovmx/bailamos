import {createHash, timingSafeEqual} from 'node:crypto';
const digest = (value: string) => createHash('sha256').update(value).digest();
// Constant-time comparison of a presented secret with the configured one. Hashing first gives both sides one length.
export function secretMatches(given: string | null | undefined, expected: string | null | undefined) {
  if (!given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
export function bearer(authorization: string | null | undefined) {
  return /^Bearer (.+)$/.exec(authorization || '')?.[1] ?? '';
}
