import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import {profileSchema, skillSchema, skillsSchema, onboardingSchema, claimSchema, instagramUsername} from '../src/lib/validation';
import {profileAbility, canEditProfile, canClaimProfile} from '../src/lib/account/permissions';
import {profileJsonLd, safeJson} from '../src/lib/account/jsonld';
import {handleBase, freeHandle} from '../src/lib/account/handle';
import {mediaUrl} from '../src/lib/account/media';
const base = {handle: 'Dancer_01', name: 'Test dancer', bio: '', cityId: 'madrid', type: 'DANCER'};
test('profile validation: handle, type, district and ownership fields', () => {
  const parsed = profileSchema.parse({...base, userId: 'attacker', id: 'x', hiddenAt: null, lat: 1, lng: 2, avatarKey: 'k', district: '  Lavapiés '});
  assert.equal(parsed.handle, 'dancer_01');
  assert.equal(parsed.district, 'Lavapiés');
  assert.equal(parsed.instagram, null);
  for (const key of ['userId', 'id', 'hiddenAt', 'lat', 'lng', 'avatarKey']) assert.equal(key in parsed, false, key);
  for (const handle of ['ab', '<script>', '-lead', 'a b c', 'x'.repeat(31), 'имя']) assert.equal(profileSchema.safeParse({...base, handle}).success, false, handle);
  assert.equal(profileSchema.safeParse({...base, type: 'ADMIN'}).success, false);
  for (const type of ['DANCER', 'ORGANIZER', 'SCHOOL', 'VENUE', 'ARTIST']) assert.equal(profileSchema.safeParse({...base, type}).success, true);
  assert.equal(profileSchema.safeParse({...base, district: 'x'.repeat(81)}).success, false);
});
test('instagram accepts only a username, never a URL or a token', () => {
  assert.equal(instagramUsername.parse('@Swing.Anna_1'), 'swing.anna_1');
  assert.equal(profileSchema.parse({...base, instagram: ''}).instagram, null);
  assert.equal(profileSchema.parse({...base, instagram: 'swing.anna'}).instagram, 'swing.anna');
  for (const value of ['https://instagram.com/anna', 'instagram.com/anna', 'anna/', 'an na', '.anna', 'anna.', 'an..na', 'IGQVJ' + 'x'.repeat(40), '<b>', '@@anna'])
    assert.equal(profileSchema.safeParse({...base, instagram: value}).success, false, value);
});
test('looking for a partner is off by default and only an explicit true enables it', () => {
  const skill = {styleId: 'lindy-hop', role: 'LEADER', level: 'BEGINNER'};
  assert.equal(skillSchema.parse(skill).lookingFor, false);
  assert.equal(skillSchema.parse({...skill, lookingFor: true}).lookingFor, true);
  for (const value of ['true', 1, 'on', null]) assert.equal(skillSchema.safeParse({...skill, lookingFor: value}).success, false, String(value));
  assert.equal(skillsSchema.parse({skills: [skill, {...skill, role: 'FOLLOWER'}]}).skills.every(s => s.lookingFor === false), true);
  assert.equal(skillsSchema.safeParse({skills: [skill, skill]}).success, false, 'duplicate style and role');
  assert.equal(skillsSchema.safeParse({skills: Array.from({length: 21}, (_, i) => ({...skill, styleId: 's' + i}))}).success, false);
  assert.equal(skillSchema.safeParse({...skill, level: 'GOD'}).success, false);
  // Onboarding has no way to request partner search at all.
  const onboarding = onboardingSchema.parse({cityId: 'madrid', styleIds: ['lindy-hop', 'balboa'], role: 'BOTH', level: 'NEWCOMER', lookingFor: true});
  assert.equal('lookingFor' in onboarding, false);
  assert.equal(onboarding.consent, false);
  assert.equal(onboardingSchema.safeParse({cityId: 'madrid', styleIds: [], role: 'BOTH', level: 'NEWCOMER'}).success, false);
  const route = readFileSync(new URL('../src/app/api/profile/onboarding/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('lookingFor: false') && !route.includes('lookingFor: true'));
});
test('claim input needs a real explanation', () => {
  assert.equal(claimSchema.safeParse({handle: 'swing-school', message: 'short'}).success, false);
  assert.equal(claimSchema.parse({handle: 'Swing-School', message: 'I am the director of this school.'}).handle, 'swing-school');
});
test('only the owner can edit a profile; only ownerless profiles can be claimed', () => {
  const mine = {userId: 'u1'}, other = {userId: 'u2'}, stub = {userId: null};
  assert.equal(canEditProfile('u1', mine), true);
  assert.equal(canEditProfile('u1', other), false);
  assert.equal(canEditProfile('u1', stub), false);
  for (const id of [undefined, null, '']) {assert.equal(canEditProfile(id, mine), false); assert.equal(canEditProfile(id, stub), false); assert.equal(canClaimProfile(id, stub), false);}
  assert.equal(canClaimProfile('u1', stub), true);
  assert.equal(canClaimProfile('u1', other), false);
  assert.equal(profileAbility(undefined).can('read', 'Profile'), true);
  assert.equal(profileAbility('u1').can('manage', 'Profile'), false);
});
test('JSON-LD type follows the profile type, exposes no coordinates and cannot break out of the script element', () => {
  const profile = {type: 'DANCER' as const, handle: 'anna', name: 'Anna </script><script>alert(1)</script>', bio: 'Hi', instagram: 'anna',
    avatarKey: 'a/b.webp', district: 'Centro', city: {name: 'Madrid', countryCode: 'ES'}, lat: 40.4, lng: -3.7, email: 'a@example.test'};
  const data = profileJsonLd(profile, 'https://dance.example');
  assert.equal(data['@type'], 'Person');
  assert.equal(data.url, 'https://dance.example/@anna');
  assert.equal(data.image, 'https://dance.example/api/media/file/a/b.webp');
  const text = safeJson(data);
  assert.equal(text.includes('<'), false);
  assert.equal(/40\.4|-3\.7|example\.test|"geo"|latitude/.test(text), false);
  assert.equal(JSON.parse(text).name, profile.name);
  assert.deepEqual((['ORGANIZER', 'SCHOOL', 'VENUE', 'ARTIST'] as const).map(type => profileJsonLd({...profile, type}, 'https://x')['@type']),
    ['Organization', 'DanceSchool', 'Place', 'Person']);
  assert.equal(mediaUrl('k'), '/api/media/file/k');
});
test('suggested handles are always valid and avoid taken ones', async () => {
  assert.equal(handleBase('María José Núñez'), 'maria-jose-nunez');
  assert.equal(handleBase('Анна'), 'dancer');
  assert.match(handleBase('x'.repeat(100)), /^[a-z0-9][a-z0-9_-]{2,29}$/);
  const handle = await freeHandle('Anna Swing', async value => value === 'anna-swing');
  assert.match(handle, /^anna-swing-[0-9a-f]{6}$/);
  assert.equal(profileSchema.safeParse({...base, handle}).success, true);
});
test('database: registration consents, protected fields, ban, export shape and cascade delete', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const {auth} = await import('../src/lib/auth');
  const {exportUserData} = await import('../src/lib/account/export');
  const {deleteAccount} = await import('../src/lib/account/delete');
  const {POLICY_VERSION} = await import('../src/lib/account/consent');
  const tag = randomUUID().slice(0, 8), email = 'account-' + tag + '@example.test', password = 'Test-only-Strong-' + randomUUID();
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  // Every call gets its own client address so the test never meets the per-IP rate limit.
  const headers = () => new Headers({origin, 'x-forwarded-for': '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250))});
  const ids: string[] = [];
  try {
    await assert.rejects(auth.api.signUpEmail({headers: headers(), body: {name: 'Too young', email: 'young-' + tag + '@example.test', password, ageConfirmed: false, locale: 'en'} as never}));
    assert.equal(await db.user.count({where: {email: 'young-' + tag + '@example.test'}}), 0);
    // A client that tries to make itself an administrator or to lift a ban is refused or overridden.
    await auth.api.signUpEmail({headers: headers(), body: {name: 'Sneaky', email: 'admin-' + tag + '@example.test', password, ageConfirmed: true, locale: 'en', role: 'ADMIN', bannedAt: new Date(), banReason: 'x'} as never}).catch(() => undefined);
    const sneaky = await db.user.findUnique({where: {email: 'admin-' + tag + '@example.test'}});
    if (sneaky) {ids.push(sneaky.id); assert.equal(sneaky.role, 'USER'); assert.equal(sneaky.bannedAt, null); assert.equal(sneaky.banReason, null);}
    await auth.api.signUpEmail({headers: headers(), body: {name: 'Account test', email, password, ageConfirmed: true, locale: 'es'} as never});
    const user = await db.user.findUniqueOrThrow({where: {email}});
    ids.push(user.id);
    assert.equal(user.role, 'USER'); assert.equal(user.ageConfirmed, true); assert.equal(user.locale, 'es');
    const consents = await db.consentLog.findMany({where: {userId: user.id}});
    assert.deepEqual(consents.map(c => c.kind).sort(), ['AGE_16', 'TERMS_PRIVACY']);
    assert.ok(consents.every(c => c.granted && c.version === POLICY_VERSION));
    await db.user.update({where: {id: user.id}, data: {emailVerified: true}});
    const signIn = await auth.api.signInEmail({headers: headers(), body: {email, password}, returnHeaders: true});
    const cookie = signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie.includes('session_token'));
    const signedIn = () => {const h = headers(); h.set('cookie', cookie); return h;};
    await auth.api.updateUser({headers: signedIn(), body: {role: 'ADMIN'} as never}).catch(() => undefined);
    await auth.api.updateUser({headers: signedIn(), body: {name: 'Renamed', ageConfirmed: false} as never}).catch(() => undefined);
    const after = await db.user.findUniqueOrThrow({where: {id: user.id}});
    assert.equal(after.role, 'USER'); assert.equal(after.ageConfirmed, true);
    const profile = await db.profile.create({data: {userId: user.id, type: 'DANCER', handle: 'acct-' + tag, name: 'Account test', lat: 40.4, lng: -3.7}});
    const style = await db.danceStyle.findFirstOrThrow();
    const skill = await db.danceSkill.create({data: {profileId: profile.id, styleId: style.id, role: 'LEADER', level: 'BEGINNER'}});
    assert.equal(skill.lookingFor, false, 'database default keeps partner search off');
    await db.notification.create({data: {userId: user.id, type: 'MODERATION', data: {note: 'test'}}});
    const data = await exportUserData(user.id);
    assert.ok(data);
    for (const key of ['user', 'signInMethods', 'sessions', 'consents', 'profile', 'skills', 'eventMemberships', 'rsvps', 'posts', 'media', 'follows',
      'notifications', 'notificationPreference', 'pushSubscriptions', 'messages', 'conversations', 'partnerInterestsSent', 'partnerInterestsReceived',
      'blocks', 'profileClaims', 'reports', 'telegram', 'exportedAt', 'formatVersion']) assert.ok(key in data, key);
    assert.equal(data.user.email, email);
    assert.equal(data.profile?.handle, 'acct-' + tag);
    assert.equal(data.skills.length, 1); assert.equal(data.consents.length, 2); assert.equal(data.notifications.length, 1);
    assert.deepEqual(data.signInMethods.map(a => a.providerId), ['credential']);
    const text = JSON.stringify(data);
    for (const secret of ['"password"', '"token"', '"accessToken"', '"refreshToken"', '"idToken"', '"p256dh"', password]) assert.equal(text.includes(secret), false, secret);
    assert.equal(await exportUserData('missing-' + tag), null);
    // A banned user cannot open a new session.
    await db.user.update({where: {id: user.id}, data: {bannedAt: new Date()}});
    await assert.rejects(auth.api.signInEmail({headers: headers(), body: {email, password}}), (error: {body?: {code?: string}}) => error.body?.code === 'BANNED');
    await db.user.update({where: {id: user.id}, data: {bannedAt: null}});
    const result = await deleteAccount(user.id);
    assert.equal(typeof result.mediaRemoved, 'boolean');
    assert.equal(await db.user.count({where: {id: user.id}}), 0);
    for (const count of [db.profile.count({where: {id: profile.id}}), db.danceSkill.count({where: {profileId: profile.id}}), db.session.count({where: {userId: user.id}}),
      db.account.count({where: {userId: user.id}}), db.consentLog.count({where: {userId: user.id}}), db.notification.count({where: {userId: user.id}})]) assert.equal(await count, 0);
  } finally {
    await db.user.deleteMany({where: {OR: [{id: {in: ids}}, {email: {endsWith: '-' + tag + '@example.test'}}]}});
    await db.verification.deleteMany({where: {OR: [{identifier: {contains: tag}}, {value: {contains: tag}}]}}).catch(() => undefined);
  }
});
test('magic link: localized mail for members only, single use, never for unknown or banned addresses', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  const mailpit = 'http://127.0.0.1:8025';
  try {await db.$queryRaw`SELECT 1`; await fetch(mailpit + '/api/v1/messages?limit=1');} catch {t.skip('PostgreSQL or Mailpit is not available'); return;}
  const {auth} = await import('../src/lib/auth');
  const tag = randomUUID().slice(0, 8), email = 'magic-' + tag + '@example.test', unknown = 'nobody-' + tag + '@example.test';
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  const headers = () => new Headers({origin, 'x-forwarded-for': '10.9.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250))});
  const inbox = async (to: string) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    const list = await (await fetch(mailpit + '/api/v1/search?query=' + encodeURIComponent('to:' + to))).json() as {messages: {ID: string; Subject: string}[]};
    return Promise.all(list.messages.map(async m => ({...m, text: (await (await fetch(mailpit + '/api/v1/message/' + m.ID)).json() as {Text: string}).Text})));
  };
  try {
    await db.user.create({data: {id: 'magic-' + tag, name: 'Magic', email, emailVerified: true, ageConfirmed: true, locale: 'ru'}});
    const ask = (to: string) => auth.api.signInMagicLink({headers: headers(), body: {email: to, callbackURL: origin + '/ru/profile', errorCallbackURL: origin + '/ru/login'}});
    assert.deepEqual(await ask(unknown), {status: true});
    assert.equal((await inbox(unknown)).length, 0, 'no mail and no account for an unknown address');
    assert.equal(await db.user.count({where: {email: unknown}}), 0);
    assert.deepEqual(await ask(email), {status: true});
    const mails = await inbox(email);
    assert.equal(mails.length, 1);
    assert.ok(mails[0].Subject.includes('Ссылка для входа'), mails[0].Subject);
    const url = mails[0].text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(url && url.includes('/api/auth/magic-link/verify?token='));
    const verify = () => auth.handler(new Request(url, {headers: headers(), redirect: 'manual'}));
    const first = await verify();
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), origin + '/ru/profile');
    assert.ok(first.headers.getSetCookie().some(c => c.includes('session_token')));
    const second = await verify();
    assert.match(second.headers.get('location') || '', /\/ru\/login\?error=INVALID_TOKEN/);
    assert.equal(second.headers.getSetCookie().some(c => c.includes('session_token=') && !c.includes('Max-Age=0')), false);
    await db.user.update({where: {email}, data: {bannedAt: new Date()}});
    assert.deepEqual(await ask(email), {status: true});
    assert.equal((await inbox(email)).length, 1, 'a banned member gets no new link');
  } finally {
    await db.user.deleteMany({where: {email: {in: [email, unknown]}}});
    await fetch(mailpit + '/api/v1/search?query=' + encodeURIComponent('to:' + email), {method: 'DELETE'}).catch(() => undefined);
  }
});
test('route handlers: onboarding, own profile only, skills, claims, export and deletion', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const {auth} = await import('../src/lib/auth');
  const profileRoute = await import('../src/app/api/profile/route');
  const skillsRoute = await import('../src/app/api/profile/skills/route');
  const onboardingRoute = await import('../src/app/api/profile/onboarding/route');
  const claimsRoute = await import('../src/app/api/claims/route');
  const exportRoute = await import('../src/app/api/account/export/route');
  const accountRoute = await import('../src/app/api/account/route');
  const tag = randomUUID().slice(0, 8), password = 'Test-only-Strong-' + randomUUID();
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  const ip = () => '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250));
  async function member(name: string) {
    const email = name + '-' + tag + '@example.test';
    await auth.api.signUpEmail({headers: new Headers({origin, 'x-forwarded-for': ip()}), body: {name: 'Route ' + name, email, password, ageConfirmed: true, locale: 'en'} as never});
    const user = await db.user.update({where: {email}, data: {emailVerified: true}});
    const signIn = await auth.api.signInEmail({headers: new Headers({origin, 'x-forwarded-for': ip()}), body: {email, password}, returnHeaders: true});
    return {id: user.id, email, cookie: signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')};
  }
  const call = async (handler: (request: Request) => Promise<Response>, method: string, body: unknown, cookie = '', from = origin) => {
    const response = await handler(new Request(origin + '/api/test', {method, headers: {'Content-Type': 'application/json', origin: from, cookie},
      ...(method === 'GET' ? {} : {body: JSON.stringify(body)})}));
    return {status: response.status, headers: response.headers, data: await response.json()};
  };
  const styles = (await db.danceStyle.findMany({take: 2, orderBy: {id: 'asc'}})).map(s => s.id), city = await db.city.findFirstOrThrow();
  let stubId = '';
  try {
    const a = await member('alice'), b = await member('bob');
    const stub = await db.profile.create({data: {type: 'SCHOOL', handle: 'stub-' + tag, name: 'Stub school'}});
    stubId = stub.id;
    const onboarding = {cityId: city.id, styleIds: styles, role: 'FOLLOWER', level: 'BEGINNER', lookingFor: true};
    assert.equal((await call(onboardingRoute.POST, 'POST', onboarding)).status, 401);
    assert.equal((await call(onboardingRoute.POST, 'POST', onboarding, a.cookie, 'https://evil.example')).status, 403);
    // Bob has no profile yet, so he may claim the stub; a second request is refused.
    const claim = await call(claimsRoute.POST, 'POST', {handle: stub.handle, message: 'I run this school and can prove it.'}, b.cookie);
    assert.equal(claim.status, 201, JSON.stringify(claim.data));
    assert.equal(claim.data.status, 'PENDING');
    assert.equal((await db.profile.findUniqueOrThrow({where: {id: stub.id}})).userId, null, 'a claim never transfers ownership by itself');
    assert.equal((await call(claimsRoute.POST, 'POST', {handle: stub.handle, message: 'I run this school and can prove it.'}, b.cookie)).data.error, 'CLAIM_EXISTS');
    const created = await call(onboardingRoute.POST, 'POST', onboarding, a.cookie);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(created.data.handle, /^[a-z0-9][a-z0-9_-]{2,29}$/);
    const mine = await db.profile.findUniqueOrThrow({where: {userId: a.id}, include: {skills: true}});
    assert.equal(mine.skills.length, styles.length);
    assert.ok(mine.skills.every(s => s.lookingFor === false), 'onboarding never enables partner search');
    assert.equal((await call(onboardingRoute.POST, 'POST', onboarding, a.cookie)).data.error, 'PROFILE_EXISTS');
    assert.equal((await call(claimsRoute.POST, 'POST', {handle: stub.handle, message: 'I also want this profile.'}, a.cookie)).data.error, 'CLAIM_HAS_PROFILE');
    assert.equal((await call(claimsRoute.POST, 'POST', {handle: mine.handle, message: 'I want this owned profile.'}, b.cookie)).data.error, 'CLAIM_NOT_AVAILABLE');
    const fields = {handle: 'alice-' + tag, name: 'Alice', bio: 'Hello', cityId: city.id, type: 'ORGANIZER', district: 'Centro', instagram: '@Alice.Swing'};
    // Ownership fields in the body are ignored: the profile written is always the caller's own.
    const saved = await call(profileRoute.PUT, 'PUT', {...fields, userId: b.id, id: stub.id, hiddenAt: null}, a.cookie);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const updated = await db.profile.findUniqueOrThrow({where: {userId: a.id}});
    assert.deepEqual([updated.id, updated.handle, updated.type, updated.district, updated.instagram], [mine.id, 'alice-' + tag, 'ORGANIZER', 'Centro', 'alice.swing']);
    assert.equal((await db.profile.findUniqueOrThrow({where: {id: stub.id}})).name, 'Stub school');
    assert.equal((await call(profileRoute.PUT, 'PUT', {...fields, handle: stub.handle}, a.cookie)).data.error, 'HANDLE_TAKEN');
    assert.equal((await call(profileRoute.PUT, 'PUT', {...fields, instagram: 'https://instagram.com/alice'}, a.cookie)).status, 400);
    assert.equal((await call(profileRoute.PUT, 'PUT', fields)).status, 401);
    assert.equal((await call(skillsRoute.PUT, 'PUT', {skills: []}, b.cookie)).data.error, 'PROFILE_REQUIRED');
    const skills = [{styleId: styles[0], role: 'LEADER', level: 'ADVANCED', lookingFor: true}, {styleId: styles[0], role: 'FOLLOWER', level: 'BEGINNER'}];
    assert.equal((await call(skillsRoute.PUT, 'PUT', {skills}, a.cookie)).status, 200);
    const stored = await db.danceSkill.findMany({where: {profileId: mine.id}, orderBy: {role: 'asc'}});
    assert.deepEqual(stored.map(s => [s.role, s.level, s.lookingFor]), [['LEADER', 'ADVANCED', true], ['FOLLOWER', 'BEGINNER', false]]);
    assert.equal((await call(skillsRoute.PUT, 'PUT', {skills: [{...skills[0], styleId: 'no-such-style-' + tag}]}, a.cookie)).status, 400);
    assert.equal(await db.danceSkill.count({where: {profileId: mine.id}}), 2, 'a rejected request leaves the skills untouched');
    assert.equal((await call(exportRoute.GET, 'GET', null)).status, 401);
    const exported = await call(exportRoute.GET, 'GET', null, a.cookie);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') || '', /^attachment; filename="dance-community-data-/);
    assert.equal(exported.data.user.email, a.email);
    assert.equal(exported.data.skills.length, 2);
    assert.equal(JSON.stringify(exported.data).includes(b.email), false);
    assert.equal((await call(accountRoute.DELETE, 'DELETE', {}, a.cookie)).data.error, 'PASSWORD_REQUIRED');
    assert.equal((await call(accountRoute.DELETE, 'DELETE', {password: 'wrong-password-123'}, a.cookie)).data.error, 'INVALID_PASSWORD');
    assert.equal(await db.user.count({where: {id: a.id}}), 1);
    const removed = await call(accountRoute.DELETE, 'DELETE', {password}, a.cookie);
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.equal(await db.user.count({where: {id: a.id}}), 0);
    assert.equal(await db.profile.count({where: {id: mine.id}}), 0);
    assert.equal((await call(exportRoute.GET, 'GET', null, a.cookie)).status, 401, 'the old session no longer works');
    assert.equal(await db.user.count({where: {id: b.id}}), 1);
  } finally {
    await db.user.deleteMany({where: {email: {endsWith: '-' + tag + '@example.test'}}});
    if (stubId) await db.profile.deleteMany({where: {id: stubId}});
    await db.verification.deleteMany({where: {OR: [{identifier: {contains: tag}}, {value: {contains: tag}}]}}).catch(() => undefined);
  }
});
