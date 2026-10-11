import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {config} from 'dotenv';
import {db, type UserRole} from '@dance/db';
config({path: '../../.env', quiet: true});

test('Google admin sign-in issues a separate session only for verified staff and never registers users', {timeout: 120000}, async () => {
  const origin = 'http://localhost:3001', clientId = 'admin-fixture.apps.googleusercontent.com', tag = randomUUID();
  Object.assign(process.env, {ADMIN_URL: origin, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'fixture-only', EMAIL_AUTH_ENABLED: 'false'});
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const kid = 'admin-fixture-' + tag;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({keys: [{...publicKey.export({format: 'jwk'}), kid, alg: 'RS256', use: 'sig'}]});
    return originalFetch(input, init);
  };
  const token = (subject: string, email: string, verified: boolean) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({alg: 'RS256', kid})).toString('base64url');
    const body = Buffer.from(JSON.stringify({iss: 'https://accounts.google.com', aud: clientId, sub: subject, email, email_verified: verified, name: 'Admin fixture', iat: now, exp: now + 300})).toString('base64url');
    const message = header + '.' + body;
    return message + '.' + sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url');
  };
  const ids: string[] = [];
  try {
    const {auth} = await import('../src/lib/auth');
    const login = (jwt: string, requestSignUp = false) => auth.handler(new Request(origin + '/api/auth/sign-in/social', {
      method: 'POST', headers: {origin, 'content-type': 'application/json', 'x-forwarded-for': '10.' + [...randomUUID().slice(0, 6).matchAll(/../g)].map(value => parseInt(value[0], 16) % 250 + 1).join('.')},
      body: JSON.stringify({provider: 'google', idToken: {token: jwt}, callbackURL: '/', requestSignUp})
    }));
    for (const [role, verified, banned] of [['OWNER', true, false], ['USER', true, false], ['ADMIN', true, true], ['ADMIN', false, false]] as [UserRole, boolean, boolean][]) {
      const id = 'admin-auth-' + randomUUID(), email = id + '@example.test', subject = 'google-' + id;
      ids.push(id);
      await db.user.create({data: {id, name: 'Admin fixture', email, emailVerified: verified, role, bannedAt: banned ? new Date() : null,
        accounts: {create: {id: randomUUID(), providerId: 'google', accountId: subject}}}});
      const response = await login(token(subject, email, verified));
      if (role === 'OWNER') {
        assert.equal(response.status, 200, await response.clone().text());
        assert.ok(response.headers.getSetCookie().some(cookie => cookie.includes('dance-admin.session_token=')));
        assert.equal(await db.session.count({where: {userId: id}}), 1);
        await db.user.update({where: {id}, data: {role: 'USER'}});
        const denied = await login(token(subject, email, verified));
        assert.equal(denied.status, 403);
        assert.equal(await db.session.count({where: {userId: id}}), 1, 'demotion must prevent a new session');
      } else {
        assert.equal(response.status, 403, await response.clone().text());
        assert.equal(await db.session.count({where: {userId: id}}), 0);
      }
    }
    const unknownEmail = 'unknown-' + tag + '@example.test';
    const unknown = await login(token('unknown-' + tag, unknownEmail, true), true);
    assert.equal(unknown.status, 403, await unknown.clone().text());
    assert.equal(await db.user.count({where: {email: unknownEmail}}), 0);
    const authorization = await auth.handler(new Request(origin + '/api/auth/sign-in/social', {method: 'POST', headers: {origin, 'content-type': 'application/json', 'x-forwarded-for': '10.17.18.19'},
      body: JSON.stringify({provider: 'google', callbackURL: '/', disableRedirect: true})}));
    assert.equal(authorization.status, 200);
    const url = new URL((await authorization.json()).url);
    assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/callback/google');
    const state = url.searchParams.get('state');
    if (state) await db.verification.deleteMany({where: {identifier: state}});
  } finally {
    globalThis.fetch = originalFetch;
    await db.user.deleteMany({where: {OR: [{id: {in: ids}}, {email: 'unknown-' + tag + '@example.test'}]}});
    await db.$disconnect();
  }
});
