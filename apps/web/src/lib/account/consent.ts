import {db} from '@dance/db';
// Bump when the terms or the privacy and retention policy change; every consent row stores the version it was given for.
export const POLICY_VERSION = '2026-09-30';
export const CONSENT_AGE = 'AGE_16';
export const CONSENT_POLICY = 'TERMS_PRIVACY';
// One registration confirmation covers both statements: "I am 16 or older" and "I accept the terms and privacy policy".
export async function logRegistrationConsents(userId: string) {
  await db.consentLog.createMany({data: [CONSENT_AGE, CONSENT_POLICY].map(kind => ({userId, kind, granted: true, version: POLICY_VERSION}))});
}
