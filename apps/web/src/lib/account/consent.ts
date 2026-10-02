import {db} from '@dance/db';
// Bump when the terms or the privacy and retention policy change; every consent row stores the version it was given for.
export const POLICY_VERSION = '2026-09-30';
export const CONSENT_AGE = 'AGE_16';
export const CONSENT_POLICY = 'TERMS_PRIVACY';
export const CONSENT_DIGEST = 'EMAIL_DIGEST';
// One registration confirmation covers both statements: "I am 16 or older" and "I accept the terms and privacy policy".
export async function logRegistrationConsents(userId: string) {
  await db.consentLog.createMany({data: [CONSENT_AGE, CONSENT_POLICY].map(kind => ({userId, kind, granted: true, version: POLICY_VERSION}))});
}
/**
 * Appends one opt-in or opt-out to the consent log. Repeating the latest answer writes nothing, so callers may
 * invoke it on every save: `await logConsent(user.id, CONSENT_DIGEST, enabled)`. Resolves to true when a row was written.
 */
export async function logConsent(userId: string, kind: string, granted: boolean) {
  const last = await db.consentLog.findFirst({where: {userId, kind}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], select: {granted: true}});
  if (last?.granted === granted) return false;
  await db.consentLog.create({data: {userId, kind, granted, version: POLICY_VERSION}});
  return true;
}
