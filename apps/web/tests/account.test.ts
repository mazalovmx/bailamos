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
      'blocks', 'profileClaims', 'reports', 'telegram', 'occurrenceRsvps', 'schoolGrants', 'exportedAt', 'formatVersion']) assert.ok(key in data, key);
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
// ---- Settings: email change, password change, sign-in methods, sessions, consent log, complete export and deletion ----
const randomIp = () => '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250));
const cookieOf = (headers: Headers) => headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
async function settingsKit() {
  const {db} = await import('@dance/db');
  const {auth} = await import('../src/lib/auth');
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin, tag = randomUUID().slice(0, 8), password = 'Test-only-Strong-' + randomUUID();
  const fresh = (cookie = '') => new Headers({origin, 'x-forwarded-for': randomIp(), ...(cookie ? {cookie} : {})});
  const signIn = async (email: string, secret = password) => cookieOf((await auth.api.signInEmail({headers: fresh(), body: {email, password: secret}, returnHeaders: true})).headers);
  async function member(name: string, locale = 'en') {
    const email = name + '-' + tag + '@example.test';
    await auth.api.signUpEmail({headers: fresh(), body: {name: 'Settings ' + name, email, password, ageConfirmed: true, locale} as never});
    const user = await db.user.update({where: {email}, data: {emailVerified: true}});
    return {id: user.id, email, cookie: await signIn(email)};
  }
  const call = async (handler: (request: Request) => Promise<Response>, method: string, body: unknown, cookie = '', from = origin) => {
    const response = await handler(new Request(origin + '/api/test', {method, headers: {'Content-Type': 'application/json', origin: from, cookie},
      ...(method === 'GET' ? {} : {body: JSON.stringify(body)})}));
    return {status: response.status, headers: response.headers, data: await response.json()};
  };
  const cleanup = async () => {
    await db.user.deleteMany({where: {email: {endsWith: '-' + tag + '@example.test'}}});
    await db.verification.deleteMany({where: {OR: [{identifier: {contains: tag}}, {value: {contains: tag}}]}}).catch(() => undefined);
  };
  return {db, auth, origin, tag, password, fresh, signIn, member, call, cleanup};
}
const code = (expected: string) => (error: {body?: {code?: string}}) => error.body?.code === expected;
test('email change: needs confirmation, mails the new address, tells the old one, changes only after the link', {timeout: 90000}, async t => {
  const mailpit = 'http://127.0.0.1:8025';
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`; await fetch(mailpit + '/api/v1/messages?limit=1');} catch {t.skip('PostgreSQL or Mailpit is not available'); return;}
  const kit = await settingsKit(), {auth, tag, origin, call} = kit;
  const route = await import('../src/app/api/account/email/route');
  const inbox = async (to: string) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    const list = await (await fetch(mailpit + '/api/v1/search?query=' + encodeURIComponent('to:' + to))).json() as {messages: {ID: string; Subject: string}[]};
    return Promise.all(list.messages.map(async m => ({...m, text: (await (await fetch(mailpit + '/api/v1/message/' + m.ID)).json() as {Text: string}).Text})));
  };
  const next = 'next-' + tag + '@example.test', addresses = [next];
  try {
    const a = await kit.member('mover', 'es'), b = await kit.member('holder'), c = await kit.member('nopass');
    addresses.push(a.email, b.email, c.email);
    // The bare Better Auth route is closed: a stolen session alone cannot move the account to another mailbox.
    await assert.rejects(auth.api.changeEmail({headers: kit.fresh(a.cookie), body: {newEmail: next}}), code('CONFIRMATION_REQUIRED'));
    const bare = await auth.handler(new Request(origin + '/api/auth/change-email', {method: 'POST', body: JSON.stringify({newEmail: next}),
      headers: {'Content-Type': 'application/json', origin, cookie: a.cookie, 'x-forwarded-for': randomIp()}}));
    assert.equal(bare.status, 403);
    assert.equal((await call(route.POST, 'POST', {newEmail: next, password: kit.password})).status, 401);
    assert.equal((await call(route.POST, 'POST', {newEmail: next, password: kit.password}, a.cookie, 'https://evil.example')).status, 403);
    assert.equal((await call(route.POST, 'POST', {newEmail: 'not-an-email', password: kit.password}, a.cookie)).status, 400);
    assert.equal((await call(route.POST, 'POST', {newEmail: next}, a.cookie)).data.error, 'PASSWORD_REQUIRED');
    assert.equal((await call(route.POST, 'POST', {newEmail: next, password: 'wrong-password-123'}, a.cookie)).data.error, 'INVALID_PASSWORD');
    assert.equal((await call(route.POST, 'POST', {newEmail: a.email.toUpperCase(), password: kit.password}, a.cookie)).data.error, 'SAME_EMAIL');
    assert.equal((await inbox(next)).length, 0, 'refused requests send nothing');
    // An address that belongs to someone else: same answer, no mail to it.
    const before = (await inbox(b.email)).length;
    const taken = await call(route.POST, 'POST', {newEmail: b.email, password: kit.password}, a.cookie);
    assert.deepEqual([taken.status, taken.data], [200, {sent: true}]);
    assert.equal((await inbox(b.email)).length, before);
    const sent = await call(route.POST, 'POST', {newEmail: ' ' + next.toUpperCase() + ' ', password: kit.password}, a.cookie);
    assert.deepEqual([sent.status, sent.data], [200, {sent: true}]);
    assert.equal((await db.user.findUniqueOrThrow({where: {id: a.id}})).email, a.email, 'nothing changes before the link is opened');
    const mails = await inbox(next);
    assert.equal(mails.length, 1);
    assert.ok(mails[0].Subject.includes('Confirma tu nuevo correo'), mails[0].Subject);
    const notices = (await inbox(a.email)).filter(m => m.Subject.includes('Solicitud de cambio de correo'));
    assert.equal(notices.length, 2, 'the old address is told about every accepted request');
    assert.ok(notices.some(m => m.text.includes(next)) && notices.every(m => !m.text.includes('verify-email')), 'the notice names the new address and carries no confirmation link');
    // Five attempts an hour per account: the sixth is refused before the password is even looked at.
    const limited = await call(route.POST, 'POST', {newEmail: next, password: kit.password}, a.cookie);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    const url = mails[0].text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(url && url.includes('/api/auth/verify-email?token='));
    const verified = await auth.handler(new Request(url, {headers: {cookie: a.cookie, 'x-forwarded-for': randomIp()}, redirect: 'manual'}));
    assert.equal(verified.status, 302);
    assert.equal(verified.headers.get('location'), origin + '/es/settings?emailChanged=1');
    const moved = await db.user.findUniqueOrThrow({where: {id: a.id}});
    assert.deepEqual([moved.email, moved.emailVerified], [next, true]);
    assert.ok(await kit.signIn(next), 'the new address signs in with the same password');
    await assert.rejects(auth.api.signInEmail({headers: kit.fresh(), body: {email: a.email, password: kit.password}}));
    // Without a password the session itself must be fresh (10 minutes).
    await db.account.deleteMany({where: {userId: c.id, providerId: 'credential'}});
    const other = 'other-' + tag + '@example.test';
    addresses.push(other);
    await db.session.updateMany({where: {userId: c.id}, data: {createdAt: new Date(Date.now() - 11 * 60 * 1000)}});
    assert.equal((await call(route.POST, 'POST', {newEmail: other}, c.cookie)).data.error, 'FRESH_LOGIN_REQUIRED');
    await db.session.updateMany({where: {userId: c.id}, data: {createdAt: new Date()}});
    assert.equal((await call(route.POST, 'POST', {newEmail: other}, c.cookie)).status, 200);
    const english = await inbox(other);
    assert.equal(english.length, 1);
    assert.ok(english[0].Subject.includes('Confirm your new email address'), english[0].Subject);
  } finally {
    await kit.cleanup();
    for (const address of addresses) await fetch(mailpit + '/api/v1/search?query=' + encodeURIComponent('to:' + address), {method: 'DELETE'}).catch(() => undefined);
    // The per-account limiter keeps a Redis connection open; close it so the test process can exit.
    await (await import('../src/lib/redis')).closeRedis();
  }
});
test('password change: current password required, 10 characters minimum, other sessions revoked', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const kit = await settingsKit(), {auth} = kit;
  try {
    const a = await kit.member('pass'), elsewhere = await kit.signIn(a.email), renewed = 'Another-Strong-' + randomUUID();
    assert.equal(await db.session.count({where: {userId: a.id}}), 2);
    await assert.rejects(auth.api.changePassword({headers: kit.fresh(), body: {currentPassword: kit.password, newPassword: renewed}}));
    await assert.rejects(auth.api.changePassword({headers: kit.fresh(a.cookie), body: {currentPassword: 'wrong-password-123', newPassword: renewed}}), code('INVALID_PASSWORD'));
    await assert.rejects(auth.api.changePassword({headers: kit.fresh(a.cookie), body: {currentPassword: kit.password, newPassword: 'short-9ch'}}), code('PASSWORD_TOO_SHORT'));
    // The same request the settings form sends, through the HTTP handler.
    const response = await auth.handler(new Request(kit.origin + '/api/auth/change-password', {method: 'POST',
      headers: {'Content-Type': 'application/json', origin: kit.origin, cookie: a.cookie, 'x-forwarded-for': randomIp()},
      body: JSON.stringify({currentPassword: kit.password, newPassword: renewed, revokeOtherSessions: true})}));
    assert.equal(response.status, 200);
    const current = cookieOf(response.headers);
    assert.ok(current.includes('session_token'), 'the changing browser stays signed in');
    assert.equal(await db.session.count({where: {userId: a.id}}), 1);
    assert.equal(await auth.api.getSession({headers: kit.fresh(elsewhere)}), null, 'the other device is signed out');
    assert.equal((await auth.api.getSession({headers: kit.fresh(current)}))?.user.id, a.id);
    await assert.rejects(auth.api.signInEmail({headers: kit.fresh(), body: {email: a.email, password: kit.password}}));
    assert.ok(await kit.signIn(a.email, renewed));
  } finally {await kit.cleanup();}
});
test('sign-in methods and sessions: Google unlink keeps a way in, linking needs a session, sign out everywhere else', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const kit = await settingsKit(), {auth, tag, call} = kit;
  const {googleEnabled} = await import('../src/lib/auth');
  const {describeAgent} = await import('../src/lib/account/sessions');
  const route = await import('../src/app/api/account/google/route');
  assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'), 'Chrome · Windows');
  assert.equal(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari · iOS');
  assert.equal(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'Firefox · Linux');
  assert.equal(describeAgent(''), null); assert.equal(describeAgent(null), null);
  try {
    const a = await kit.member('methods'), b = await kit.member('googleonly');
    const google = (userId: string) => db.account.create({data: {id: 'g-' + userId + '-' + tag, accountId: 'google-' + userId, providerId: 'google', userId}});
    assert.equal((await call(route.DELETE, 'DELETE', {})).status, 401);
    assert.equal((await call(route.DELETE, 'DELETE', {}, a.cookie)).data.error, 'GOOGLE_NOT_LINKED');
    await google(a.id); await google(b.id);
    assert.equal((await call(route.DELETE, 'DELETE', {}, a.cookie, 'https://evil.example')).status, 403);
    const unlinked = await call(route.DELETE, 'DELETE', {}, a.cookie);
    assert.deepEqual([unlinked.status, unlinked.data], [200, {linked: false}]);
    assert.deepEqual((await db.account.findMany({where: {userId: a.id}})).map(x => x.providerId), ['credential']);
    assert.equal(await db.account.count({where: {userId: b.id, providerId: 'google'}}), 1, 'only the caller is touched');
    // Without a password Google is the only stored method: it stays.
    await db.account.deleteMany({where: {userId: b.id, providerId: 'credential'}});
    const refused = await call(route.DELETE, 'DELETE', {}, b.cookie);
    assert.deepEqual([refused.status, refused.data.error], [409, 'LAST_SIGN_IN_METHOD']);
    assert.equal(await db.account.count({where: {userId: b.id, providerId: 'google'}}), 1);
    // Linking is offered only when Google is configured, and never without a session.
    const link = (cookie = '') => auth.api.linkSocialAccount({headers: kit.fresh(cookie), body: {provider: 'google', callbackURL: kit.origin + '/en/settings'}});
    await assert.rejects(link());
    if (googleEnabled()) assert.match((await link(a.cookie)).url, /^https:\/\/accounts\.google\.com\//);
    else await assert.rejects(link(a.cookie), code('PROVIDER_NOT_FOUND'));
    const second = await kit.signIn(a.email), third = await kit.signIn(a.email);
    assert.equal((await auth.api.listSessions({headers: kit.fresh(a.cookie)})).length, 3);
    const revoked = await auth.handler(new Request(kit.origin + '/api/auth/revoke-other-sessions', {method: 'POST',
      headers: {'Content-Type': 'application/json', origin: kit.origin, cookie: second, 'x-forwarded-for': randomIp()}, body: '{}'}));
    assert.equal(revoked.status, 200);
    assert.equal(await db.session.count({where: {userId: a.id}}), 1);
    assert.equal((await auth.api.getSession({headers: kit.fresh(second)}))?.user.id, a.id, 'the session that asked survives');
    for (const gone of [a.cookie, third]) assert.equal(await auth.api.getSession({headers: kit.fresh(gone)}), null);
    assert.equal(await db.session.count({where: {userId: b.id}}), 1, 'other accounts are not affected');
  } finally {await kit.cleanup();}
});
test('consent log: digest opt-in and opt-out are recorded once per change, and every kind has a label', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const kit = await settingsKit(), {call} = kit;
  const route = await import('../src/app/api/digest/subscription/route');
  const {logConsent, CONSENT_DIGEST, CONSENT_AGE, CONSENT_POLICY, POLICY_VERSION} = await import('../src/lib/account/consent');
  for (const locale of ['en', 'es', 'ru']) {
    const messages = JSON.parse(readFileSync(new URL('../messages/features/Account/' + locale + '.json', import.meta.url), 'utf8'));
    for (const kind of [CONSENT_AGE, CONSENT_POLICY, CONSENT_DIGEST]) assert.ok(messages['consent_' + kind], locale + ' consent_' + kind);
    for (const key of ['consentGranted', 'consentWithdrawn']) assert.ok(messages[key], locale + ' ' + key);
  }
  try {
    const a = await kit.member('consent'), b = await kit.member('quiet');
    const log = (userId = a.id) => db.consentLog.findMany({where: {userId, kind: CONSENT_DIGEST}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]});
    assert.equal((await call(route.PUT, 'PUT', {enabled: true})).status, 401);
    assert.equal((await call(route.PUT, 'PUT', {enabled: 'yes'}, a.cookie)).status, 400);
    assert.deepEqual((await call(route.GET, 'GET', null, a.cookie)).data, {enabled: false});
    // Switching off what was never on is not a withdrawal.
    assert.equal((await call(route.PUT, 'PUT', {enabled: false}, a.cookie)).status, 200);
    assert.equal((await log()).length, 0);
    assert.deepEqual((await call(route.PUT, 'PUT', {enabled: true}, a.cookie)).data, {enabled: true});
    assert.deepEqual((await call(route.PUT, 'PUT', {enabled: true}, a.cookie)).data, {enabled: true});
    assert.deepEqual((await log()).map(row => [row.granted, row.version]), [[true, POLICY_VERSION]]);
    assert.deepEqual((await call(route.PUT, 'PUT', {enabled: false}, a.cookie)).data, {enabled: false});
    assert.deepEqual((await call(route.PUT, 'PUT', {enabled: true}, a.cookie)).data, {enabled: true});
    assert.deepEqual((await log()).map(row => row.granted), [true, false, true]);
    assert.deepEqual((await call(route.GET, 'GET', null, a.cookie)).data, {enabled: true});
    assert.equal((await log(b.id)).length, 0);
    // The helper other features call: repeating the latest answer writes nothing.
    assert.equal(await logConsent(b.id, 'PARTNER_SEARCH', true), true);
    assert.equal(await logConsent(b.id, 'PARTNER_SEARCH', true), false);
    assert.equal(await logConsent(b.id, 'PARTNER_SEARCH', false), true);
    assert.equal(await db.consentLog.count({where: {userId: b.id, kind: 'PARTNER_SEARCH'}}), 2);
  } finally {await kit.cleanup();}
});
test('export covers and deletion removes per-date RSVPs, chat, partner interests, blocks, push, Telegram and school grants', {timeout: 60000}, async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const kit = await settingsKit(), {tag} = kit;
  const {exportUserData} = await import('../src/lib/account/export');
  const {deleteAccount} = await import('../src/lib/account/delete');
  const ids = {event: '', school: '', conversations: [] as string[]};
  try {
    const a = await kit.member('leaver'), b = await kit.member('stayer');
    const city = await db.city.findFirstOrThrow(), style = await db.danceStyle.findFirstOrThrow();
    const [pa, pb] = await Promise.all([a, b].map((user, i) => db.profile.create({data: {userId: user.id, type: 'DANCER', handle: (i ? 'stay-' : 'leave-') + tag, name: i ? 'Stayer' : 'Leaver'}})));
    const school = await db.profile.create({data: {type: 'SCHOOL', handle: 'school-' + tag, name: 'School ' + tag}});
    ids.school = school.id;
    const event = await db.event.create({data: {slug: 'series-' + tag, title: 'Series ' + tag, startsAt: new Date(Date.now() + 864e5), timezone: city.timezone, cityId: city.id,
      status: 'PUBLISHED', members: {create: {profileId: pb.id, role: 'OWNER'}}, occurrences: {create: {startsAt: new Date(Date.now() + 864e5)}}}, include: {occurrences: true}});
    ids.event = event.id;
    const secret = 'push-auth-' + tag, endpoint = 'https://push.example.test/send/' + tag, chatId = 'tg-' + tag;
    const key = [pa.id, pb.id].sort().join(':');
    const conversation = (data: {kind: 'DIRECT' | 'GROUP'; directKey?: string; title?: string}, members: string[], texts: [string, string][]) => db.conversation.create({data: {...data,
      members: {create: members.map(profileId => ({profileId}))}, messages: {create: texts.map(([senderProfileId, body]) => ({senderProfileId, body}))}}});
    const direct = await conversation({kind: 'DIRECT', directKey: key}, [pa.id, pb.id], [[pa.id, 'hello from leaver ' + tag], [pb.id, 'reply from stayer ' + tag]]);
    const solo = await conversation({kind: 'GROUP', title: 'Solo ' + tag}, [pa.id], [[pa.id, 'note to self ' + tag]]);
    const shared = await conversation({kind: 'GROUP', title: 'Shared ' + tag}, [pa.id, pb.id], [[pa.id, 'group line ' + tag], [pb.id, 'group answer ' + tag]]);
    ids.conversations.push(direct.id, solo.id, shared.id);
    const expiresAt = new Date(Date.now() + 864e5);
    await Promise.all([
      db.occurrenceRsvp.create({data: {occurrenceId: event.occurrences[0].id, profileId: pa.id, status: 'GOING'}}),
      db.rsvp.create({data: {eventId: event.id, profileId: pa.id, status: 'INTERESTED'}}),
      db.partnerInterest.create({data: {fromProfileId: pa.id, toProfileId: pb.id, styleId: style.id}}),
      db.partnerInterest.create({data: {fromProfileId: pb.id, toProfileId: pa.id}}),
      db.block.create({data: {blockerProfileId: pa.id, blockedProfileId: school.id}}),
      db.block.create({data: {blockerProfileId: pb.id, blockedProfileId: pa.id}}),
      db.pushSubscription.create({data: {userId: a.id, endpoint, p256dh: 'p256-' + tag, auth: secret}}),
      db.telegramChat.create({data: {chatId, userId: a.id, notify: true, locale: 'ru'}}),
      db.schoolAdmin.create({data: {userId: a.id, schoolProfileId: school.id}}),
      db.eventInvite.create({data: {eventId: event.id, profileId: pa.id, token: 'to-' + tag, invitedByProfileId: pb.id, expiresAt}}),
      db.eventInvite.create({data: {eventId: event.id, email: a.email.toUpperCase(), token: 'mail-' + tag, invitedByProfileId: pb.id, expiresAt}}),
      db.eventInvite.create({data: {eventId: event.id, email: 'guest-' + tag + '@example.test', token: 'from-' + tag, invitedByProfileId: pa.id, expiresAt}}),
      db.eventInvite.create({data: {eventId: event.id, profileId: school.id, token: 'keep-' + tag, invitedByProfileId: pb.id, expiresAt}})]);
    const data = await exportUserData(a.id);
    assert.ok(data);
    assert.equal(data.formatVersion, 2);
    assert.deepEqual(data.occurrenceRsvps.map(r => [r.status, r.eventId, r.event.slug, r.startsAt.getTime()]), [['GOING', event.id, event.slug, event.occurrences[0].startsAt.getTime()]]);
    assert.equal(data.rsvps.length, 1);
    assert.deepEqual(data.messages.map(m => m.body).sort(), ['group line ' + tag, 'hello from leaver ' + tag, 'note to self ' + tag]);
    assert.deepEqual(data.conversations.map(c => c.kind).sort(), ['DIRECT', 'GROUP', 'GROUP']);
    assert.deepEqual(data.blocks.map(x => x.blockedProfileId), [school.id]);
    assert.deepEqual(data.partnerInterestsSent.map(i => [i.toProfileId, i.styleId]), [[pb.id, style.id]]);
    assert.deepEqual(data.partnerInterestsReceived.map(i => i.fromProfileId), [pb.id]);
    assert.deepEqual(data.pushSubscriptions.map(s => s.endpointHost), ['push.example.test']);
    assert.deepEqual([data.telegram.linked, data.telegram.notify, data.telegram.locale], [true, true, 'ru']);
    assert.deepEqual(data.schoolGrants.map(g => [g.schoolProfileId, g.handle]), [[school.id, 'school-' + tag]]);
    const text = JSON.stringify(data);
    for (const hidden of [endpoint, secret, 'p256-' + tag, chatId, 'reply from stayer', 'group answer', b.email]) assert.equal(text.includes(hidden), false, hidden);
    assert.deepEqual((await exportUserData(b.id))?.telegram, {linked: false});
    await deleteAccount(a.id);
    const zero = await Promise.all([db.user.count({where: {id: a.id}}), db.profile.count({where: {id: pa.id}}),
      db.occurrenceRsvp.count({where: {profileId: pa.id}}), db.rsvp.count({where: {profileId: pa.id}}),
      db.message.count({where: {senderProfileId: pa.id}}), db.conversationMember.count({where: {profileId: pa.id}}),
      db.conversation.count({where: {id: {in: [direct.id, solo.id]}}}), db.conversation.count({where: {directKey: {contains: pa.id}}}),
      db.message.count({where: {conversationId: direct.id}}),
      db.partnerInterest.count({where: {OR: [{fromProfileId: pa.id}, {toProfileId: pa.id}]}}),
      db.block.count({where: {OR: [{blockerProfileId: pa.id}, {blockedProfileId: pa.id}]}}),
      db.pushSubscription.count({where: {endpoint}}), db.telegramChat.count({where: {chatId}}),
      db.schoolAdmin.count({where: {userId: a.id}}), db.eventInvite.count({where: {token: {in: ['to-' + tag, 'mail-' + tag, 'from-' + tag]}}}),
      db.session.count({where: {userId: a.id}}), db.consentLog.count({where: {userId: a.id}})]);
    assert.deepEqual(zero, zero.map(() => 0));
    // Everything that belongs to others stays.
    assert.equal(await db.user.count({where: {id: b.id}}), 1);
    assert.equal(await db.profile.count({where: {id: {in: [pb.id, school.id]}}}), 2);
    assert.equal(await db.event.count({where: {id: event.id}}), 1);
    assert.equal(await db.eventInvite.count({where: {token: 'keep-' + tag}}), 1);
    assert.deepEqual((await db.conversationMember.findMany({where: {conversationId: shared.id}})).map(m => m.profileId), [pb.id]);
    assert.deepEqual((await db.message.findMany({where: {conversationId: shared.id}})).map(m => m.body), ['group answer ' + tag]);
    assert.deepEqual(await deleteAccount(a.id), {mediaRemoved: true}, 'deleting twice is harmless');
  } finally {
    await db.conversation.deleteMany({where: {id: {in: ids.conversations}}});
    await db.telegramChat.deleteMany({where: {chatId: 'tg-' + tag}});
    if (ids.event) await db.event.deleteMany({where: {id: ids.event}});
    await db.eventInvite.deleteMany({where: {token: {endsWith: '-' + tag}}});
    await kit.cleanup();
    if (ids.school) await db.profile.deleteMany({where: {id: ids.school}});
  }
});
