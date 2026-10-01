import {createHmac, timingSafeEqual} from 'node:crypto';
// One-click unsubscribe link for the weekly digest: "<base64url(userId)>.<HMAC-SHA256>", signed with BETTER_AUTH_SECRET.
// The token only ever switches the digest off for that one account, so it does not expire: links in old emails keep working.
function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error('BETTER_AUTH_SECRET is required to sign unsubscribe links');
  return value;
}
const sign = (userId: string) => createHmac('sha256', secret()).update('digest-unsubscribe\n' + userId).digest('base64url');
export function unsubscribeToken(userId: string) {
  return Buffer.from(userId, 'utf8').toString('base64url') + '.' + sign(userId);
}
/** Returns the user id the token was issued for, or null when it is malformed, altered or signed with another secret. */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  if (!token || token.length > 400) return null;
  const match = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const userId = Buffer.from(match[1], 'base64url').toString('utf8');
  // Re-encoding rejects non-canonical spellings of the same id.
  if (!userId || Buffer.from(userId, 'utf8').toString('base64url') !== match[1]) return null;
  const expected = Buffer.from(sign(userId)), given = Buffer.from(match[2]);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
