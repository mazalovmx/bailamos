import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, verify} from 'node:crypto';
import {config} from 'dotenv';
import {enabledSocialProviders, isSocialProvider, socialSignInRequest, socialClientCredentials} from '../src/lib/account/social-providers';
import {appleClientSecret} from '../src/lib/account/apple-secret';
config({path: '../../.env', quiet: true});

test('providers require complete nonempty credentials and accept only the supported IDs', () => {
  assert.deepEqual(enabledSocialProviders({}), []);
  assert.deepEqual(enabledSocialProviders({GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: ' '}), []);
  assert.deepEqual(enabledSocialProviders({MICROSOFT_CLIENT_ID: 'id'}), []);
  assert.deepEqual(enabledSocialProviders({CLIENT_ID_GOOGLE: ' id ', CLIENT_SECRET_GOOGLE: ' secret '}), ['google']);
  assert.deepEqual(socialClientCredentials('google', {CLIENT_ID_GOOGLE: ' id ', CLIENT_SECRET_GOOGLE: ' secret '}), {clientId: 'id', clientSecret: 'secret'});
  assert.equal(socialClientCredentials('google', {GOOGLE_CLIENT_ID: 'id', CLIENT_SECRET_GOOGLE: 'secret'}), undefined, 'never combine parts of different credential pairs');
  assert.deepEqual(enabledSocialProviders({APPLE_CLIENT_ID: 'id', APPLE_TEAM_ID: 'team', APPLE_KEY_ID: 'key'}), []);
  assert.deepEqual(enabledSocialProviders({GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', MICROSOFT_CLIENT_ID: 'id',
    MICROSOFT_CLIENT_SECRET: 'secret', APPLE_CLIENT_ID: 'id', APPLE_TEAM_ID: 'team', APPLE_KEY_ID: 'key', APPLE_PRIVATE_KEY: 'key'}), ['google', 'microsoft', 'apple']);
  assert.equal(isSocialProvider('apple'), true);
  for (const id of ['Apple', 'credential', '../google', 'attacker']) assert.equal(isSocialProvider(id), false);
});

test('recovery cannot sign up and returns to settings; normal registration retains onboarding and safe return paths', () => {
  for (const provider of ['google', 'microsoft', 'apple'] as const) {
    const recovery = socialSignInRequest(provider, 'forgot', 'ru', 'http://localhost:3000', '/ru/events/new');
    assert.equal(recovery.requestSignUp, false);
    assert.equal(recovery.callbackURL, 'http://localhost:3000/ru/settings');
    assert.equal(recovery.errorCallbackURL, 'http://localhost:3000/ru/forgot-password?next=%2Fru%2Fevents%2Fnew');
    const registration = socialSignInRequest(provider, 'register', 'es', 'http://localhost:3000', '/es/events/new');
    assert.equal(registration.requestSignUp, true);
    assert.equal(registration.newUserCallbackURL, 'http://localhost:3000/es/onboarding?next=%2Fes%2Fevents%2Fnew');
    assert.equal(registration.callbackURL, 'http://localhost:3000/es/events/new');
    const hostile = socialSignInRequest(provider, 'login', 'en', 'http://localhost:3000', '//attacker.test');
    assert.equal(hostile.callbackURL, 'http://localhost:3000/en/account');
    assert.equal(hostile.errorCallbackURL, 'http://localhost:3000/en/login');
  }
});

test('Apple client secret has a verifiable P-256 signature, correct audience and short expiration', () => {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const pem = privateKey.export({format: 'pem', type: 'pkcs8'}).toString();
  const jwt = appleClientSecret({clientId: 'test.services', teamId: 'TEAM', keyId: 'KEY', privateKey: pem.replace(/\n/g, '\\n')}, 1700000000);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {alg: 'ES256', kid: 'KEY'});
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {iss: 'TEAM', sub: 'test.services', aud: 'https://appleid.apple.com', iat: 1700000000, exp: 1700003600});
  assert.equal(verify('sha256', Buffer.from(header + '.' + payload), {key: publicKey, dsaEncoding: 'ieee-p1363'}, Buffer.from(signature, 'base64url')), true);
  const wrong = generateKeyPairSync('ec', {namedCurve: 'secp384r1'}).privateKey.export({format: 'pem', type: 'pkcs8'}).toString();
  assert.throws(() => appleClientSecret({clientId: 'id', teamId: 'team', keyId: 'key', privateKey: wrong}), /APPLE_KEY_MUST_BE_P256/);
});

test('OAuth endpoints generate provider-specific authorization URLs and unlink routes protect existing accounts', {timeout: 60000}, async () => {
  // These fixture credentials are process-local and never saved to the environment file or used with real providers.
  const key = generateKeyPairSync('ec', {namedCurve: 'prime256v1'}).privateKey.export({format: 'pem', type: 'pkcs8'}).toString();
  Object.assign(process.env, {GOOGLE_CLIENT_ID: 'oauth-test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fixture-only',
    MICROSOFT_CLIENT_ID: '11111111-2222-3333-4444-555555555555', MICROSOFT_CLIENT_SECRET: 'fixture-only',
    APPLE_CLIENT_ID: 'test.bailamos.web', APPLE_TEAM_ID: 'TESTTEAM', APPLE_KEY_ID: 'TESTKEY', APPLE_PRIVATE_KEY: key});
  const {auth} = await import('../src/lib/auth');
  const {db} = await import('@dance/db');
  const {DELETE} = await import('../src/app/api/account/providers/[provider]/route');
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  const tag = randomUUID(), password = 'Social-test-' + randomUUID(), states: string[] = [];
  const fresh = (cookie = '') => new Headers({origin, 'x-forwarded-for': '10.' + [...randomUUID().slice(0, 6).matchAll(/../g)].map(m => parseInt(m[0], 16) % 250 + 1).join('.'), ...(cookie ? {cookie} : {})});
  const kit = {origin, fresh, member: async (name: string) => {
    const email = name + '-' + tag + '@example.test';
    await auth.api.signUpEmail({headers: fresh(), body: {name: 'Social ' + name, email, password, ageConfirmed: true, locale: 'en'} as never});
    const user = await db.user.update({where: {email}, data: {emailVerified: true}});
    const login = await auth.api.signInEmail({headers: fresh(), body: {email, password}, returnHeaders: true});
    return {id: user.id, cookie: login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')};
  }, clean: async () => {
    await db.user.deleteMany({where: {email: {endsWith: '-' + tag + '@example.test'}}});
    await db.verification.deleteMany({where: {identifier: {in: states}}});
  }};
  try {
    const urls: Record<string, string> = {google: 'accounts.google.com', microsoft: 'login.microsoftonline.com', apple: 'appleid.apple.com'};
    for (const provider of ['google', 'microsoft', 'apple'] as const) {
      const result = await auth.api.signInSocial({headers: kit.fresh(), body: socialSignInRequest(provider, 'forgot', 'en', kit.origin)});
      assert.ok(result.url);
      const url = new URL(result.url!);
      assert.equal(url.hostname, urls[provider]);
      assert.equal(url.searchParams.get('redirect_uri'), kit.origin + '/api/auth/callback/' + provider);
      assert.ok(url.searchParams.get('state'));
      states.push(url.searchParams.get('state')!);
      const state = await db.verification.findFirstOrThrow({where: {identifier: url.searchParams.get('state')!}});
      const stored = JSON.parse(state.value);
      assert.equal(stored.requestSignUp, false, 'the server preserves the no-registration recovery request');
      assert.equal(stored.callbackURL, kit.origin + '/en/settings');
      const option = auth.options.socialProviders[provider];
      const providerOptions = typeof option === 'function' ? await option() : option;
      assert.equal(providerOptions?.disableImplicitSignUp, true, 'the provider enforces explicit registration');
      if (provider !== 'apple') assert.equal(url.searchParams.get('prompt'), 'select_account');
    }
    const a = await kit.member('password'), b = await kit.member('social-only');
    for (const user of [a, b]) for (const provider of ['microsoft', 'apple']) await db.account.create({data: {id: user.id + '-' + provider,
      accountId: user.id, userId: user.id, providerId: provider}});
    await db.account.deleteMany({where: {userId: b.id, providerId: 'credential'}});
    const request = (cookie = '') => new Request(kit.origin + '/api/account/providers/microsoft', {method: 'DELETE', headers: kit.fresh(cookie)});
    const params = (provider: string) => ({params: Promise.resolve({provider})});
    assert.equal((await DELETE(request(), params('microsoft'))).status, 401);
    assert.equal((await DELETE(new Request(kit.origin + '/api/account/providers/apple', {method: 'DELETE', headers: {origin: 'https://attacker.test', cookie: a.cookie}}), params('apple'))).status, 403);
    assert.equal((await DELETE(request(a.cookie), params('credential'))).status, 404);
    assert.equal((await DELETE(request(b.cookie), params('apple'))).status, 409);
    assert.equal((await DELETE(request(a.cookie), params('microsoft'))).status, 200);
    assert.equal(await db.account.count({where: {userId: b.id, providerId: 'microsoft'}}), 1);
    assert.equal(await db.account.count({where: {userId: a.id, providerId: 'apple'}}), 1);
    assert.equal((await DELETE(request(a.cookie), params('microsoft'))).status, 404);
  } finally {await kit.clean(); await db.$disconnect();}
});
