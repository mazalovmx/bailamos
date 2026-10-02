// Shared helpers of the signed-in audits: the account from .env (`login`, `password`) and throwaway accounts.
// Credentials are read from the environment and never printed.
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db} from '@dance/db';
config({path: '../../.env', quiet: true});
export const web = process.env.AUDIT_ORIGIN || 'http://localhost:3000', admin = process.env.AUDIT_ADMIN || 'http://localhost:3001';
export const tag = randomUUID().slice(0, 6);
const created: string[] = [];
export async function call(origin: string, path: string, method: string, body?: unknown, cookie = '') {
  return fetch(origin + path, {method, redirect: 'manual', headers: {'Content-Type': 'application/json', Origin: origin, ...(cookie ? {Cookie: cookie} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
}
export async function signIn(origin: string, email: string, password: string) {
  const response = await call(origin, '/api/auth/sign-in/email', 'POST', {email, password});
  if (!response.ok) throw new Error('sign-in failed at ' + origin + ': ' + response.status + ' ' + (await response.text()).slice(0, 120));
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
export function envAccount() {
  const email = process.env.login?.trim(), password = process.env.password;
  if (!email || !password) throw new Error('.env has no `login` / `password`');
  return {email, password};
}
// A throwaway verified account; with `kind` it also gets a profile through the real onboarding endpoint.
export async function makeAccount(name: string, kind?: 'DANCER' | 'SCHOOL' | 'ORGANIZER') {
  const email = name.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + tag + '@example.test', password = 'Audit-' + randomUUID();
  const made = await call(web, '/api/auth/sign-up/email', 'POST', {name, email, password, ageConfirmed: true, locale: 'en'});
  if (!made.ok) throw new Error('sign-up failed: ' + made.status);
  const user = await db.user.update({where: {email}, data: {emailVerified: true}});
  created.push(user.id);
  const cookie = await signIn(web, email, password);
  let profileId = '', handle = '';
  if (kind) {
    const city = await db.city.findFirstOrThrow({where: {slug: 'madrid'}});
    const onboarding = await call(web, '/api/profile/onboarding', 'POST', {type: kind, cityId: city.id,
      ...(kind === 'DANCER' ? {styleIds: ['lindy-hop'], role: name.includes('Leo') ? 'LEADER' : 'FOLLOWER', level: 'INTERMEDIATE'} : {})}, cookie);
    if (!onboarding.ok) throw new Error('onboarding failed: ' + onboarding.status + ' ' + (await onboarding.text()).slice(0, 120));
    const profile = await db.profile.findFirstOrThrow({where: {userId: user.id}});
    profileId = profile.id; handle = profile.handle;
  }
  return {id: user.id, email, password, cookie, name, profileId, handle};
}
export async function cleanup() {
  const profiles = await db.profile.findMany({where: {userId: {in: created}}, select: {id: true}}), ids = profiles.map(profile => profile.id);
  await db.event.deleteMany({where: {members: {some: {profileId: {in: ids}, role: 'OWNER'}}}});
  // Stub artists created from the audit events have no owner; they are recognisable by the tag in their name.
  await db.profile.deleteMany({where: {userId: null, name: {contains: tag}}});
  await db.report.deleteMany({where: {reporterUserId: {in: created}}});
  await db.user.deleteMany({where: {id: {in: created}}});
  await db.$disconnect();
}
