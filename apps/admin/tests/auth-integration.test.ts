import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {config} from 'dotenv';
import {db, type UserRole} from '@dance/db';
config({path: '../../.env', quiet: true});

test('Google admin sign-in protects staff sessions and lets only owners provision administrators by email', {timeout: 120000}, async () => {
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
  const schools: string[] = [];
  const emails = ['invited-', 'existing-', 'forbidden-', 'mixed-', 'duplicate-'].map(prefix => prefix + tag + '@example.test');
  try {
    const {POST, GET} = await import('../src/app/api/auth/[...all]/route');
    const login = (jwt: string, requestSignUp = false) => POST(new Request(origin + '/api/auth/sign-in/social', {
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
        assert.equal((await login(token(subject, 'wrong-' + email, true))).status, 403, 'a linked Google identity must still match the approved email');
        assert.equal((await login(token(subject, email, false))).status, 403, 'a fresh unverified Google email must not issue a staff session');
        await db.user.update({where: {id}, data: {role: 'USER'}});
        const denied = await login(token(subject, email, verified));
        assert.equal(denied.status, 403);
        assert.equal(await db.session.count({where: {userId: id}}), 1, 'demotion must prevent a new session');
      } else {
        assert.equal(response.status, 403, await response.clone().text());
        assert.equal(await db.session.count({where: {userId: id}}), 0);
      }
    }
    const {POST: addUser} = await import('../src/app/api/users/route');
    const {addAdminByEmail} = await import('../src/lib/admin-users');
    const {setUserRole} = await import('../src/lib/moderation');
    const ownerId = 'add-owner-' + tag, ownerEmail = ownerId + '@example.test', ownerSubject = 'google-' + ownerId;
    ids.push(ownerId);
    await db.user.create({data: {id: ownerId, name: 'Owner', email: ownerEmail, emailVerified: true, role: 'OWNER',
      accounts: {create: {id: randomUUID(), providerId: 'google', accountId: ownerSubject}}}});
    const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const ownerLogin = await login(token(ownerSubject, ownerEmail, true));
    assert.equal(ownerLogin.status, 200);
    const ownerCookie = cookieOf(ownerLogin);
    const add = (body: unknown, cookie = ownerCookie, source = origin) => addUser(new Request(origin + '/api/users', {
      method: 'POST', headers: {origin: source, cookie, 'content-type': 'application/json'}, body: JSON.stringify(body)
    }), undefined);
    assert.equal((await add({email: emails[2]}, '')).status, 401);
    assert.equal((await add({email: emails[2]}, ownerCookie, 'https://other.example')).status, 403);
    assert.equal((await add({email: 'invalid'})).status, 400);
    assert.equal((await add({email: emails[2], role: 'OWNER'})).status, 400);
    assert.equal((await add({email: ownerEmail})).status, 400, 'owners cannot overwrite their own role');

    const provision = await add({email: '  ' + emails[0].toUpperCase() + '  '});
    assert.equal(provision.status, 201, await provision.clone().text());
    const invited = await provision.json();
    ids.push(invited.id);
    assert.equal(invited.email, emails[0]);
    assert.equal(invited.loginUrl, origin + '/login');
    let stored = await db.user.findUniqueOrThrow({where: {id: invited.id}});
    assert.equal(stored.role, 'ADMIN');
    assert.equal(stored.emailVerified, false, 'adding an email does not verify it');
    assert.equal(await db.account.count({where: {userId: invited.id}}), 0);
    assert.equal(await db.session.count({where: {userId: invited.id}}), 0);
    const repeat = await add({email: emails[0]});
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).id, invited.id);
    assert.equal(await db.auditLog.count({where: {targetId: invited.id, action: 'USER_ADMIN_ADD'}}), 1);
    const unverified = await login(token('google-' + invited.id, emails[0], false));
    assert.ok(unverified.status >= 400 && unverified.status < 500, 'unverified Google email must be denied');
    assert.equal(await db.account.count({where: {userId: invited.id}}), 0, 'an unverified provider must not link to an invitation');
    const invitedLogin = await login(token('google-' + invited.id, emails[0], true));
    assert.equal(invitedLogin.status, 200, await invitedLogin.clone().text());
    assert.ok(invitedLogin.headers.getSetCookie().some(value => value.includes('dance-admin.session_token=')));
    stored = await db.user.findUniqueOrThrow({where: {id: invited.id}});
    assert.equal(stored.emailVerified, true);
    assert.equal(stored.name, 'Admin fixture', 'the new Google account supplies its display name');
    assert.equal(await db.account.count({where: {userId: invited.id, providerId: 'google'}}), 1);
    assert.equal((await add({email: emails[2]}, cookieOf(invitedLogin))).status, 403, 'administrators cannot appoint more administrators');
    await assert.rejects(addAdminByEmail(invited.id, {email: emails[2]}), /OWNER_ONLY/);
    assert.equal(await db.user.count({where: {email: emails[2]}}), 0);

    const existingId = 'existing-admin-' + tag;
    ids.push(existingId);
    await db.user.create({data: {id: existingId, name: 'Existing user', email: emails[1], emailVerified: true,
      sessions: {create: {id: randomUUID(), token: randomUUID(), expiresAt: new Date(Date.now() + 60000)}}}});
    const upgraded = await add({email: emails[1]});
    assert.equal(upgraded.status, 200);
    assert.equal((await upgraded.json()).id, existingId);
    assert.equal((await db.user.findUniqueOrThrow({where: {id: existingId}})).role, 'ADMIN');
    assert.equal(await db.session.count({where: {userId: existingId}}), 0, 'changing a role revokes prior sessions');
    assert.equal(await db.auditLog.count({where: {targetId: existingId, action: 'USER_ROLE'}}), 1);
    await db.user.update({where: {id: existingId}, data: {bannedAt: new Date()}});
    const blocked = await add({email: emails[1]});
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error, 'USER_BANNED');

    const mixedId = 'mixed-admin-' + tag;
    ids.push(mixedId);
    await db.user.create({data: {id: mixedId, name: 'Legacy email', email: emails[3].toUpperCase()}});
    assert.equal((await add({email: emails[3]})).status, 200);
    assert.equal((await db.user.findUniqueOrThrow({where: {id: mixedId}})).email, emails[3]);
    assert.equal((await login(token('google-' + mixedId, emails[3], true))).status, 200);
    for (const email of [emails[4], emails[4].toUpperCase()]) {
      const id = randomUUID(); ids.push(id);
      await db.user.create({data: {id, name: 'Duplicate fixture', email}});
    }
    assert.equal((await add({email: emails[4]})).status, 409, 'ambiguous legacy emails are not assigned arbitrarily');
    const {createSchool, grantSchool} = await import('../src/lib/schools');
    const a = await createSchool(ownerId, {name: 'Scoped login A', handle: 'login-a-' + tag.slice(0, 8)}); schools.push(a.id);
    const b = await createSchool(ownerId, {name: 'Scoped login B', handle: 'login-b-' + tag.slice(0, 8)}); schools.push(b.id);
    const schoolEmail = 'school-' + tag + '@example.test'; emails.push(schoolEmail);
    const schoolAdded = await add({email: schoolEmail, scope: 'school', schoolId: a.id, role: 'MANAGER'});
    assert.equal(schoolAdded.status, 201, await schoolAdded.clone().text());
    const scoped = await schoolAdded.json(); ids.push(scoped.id);
    assert.equal((await db.user.findUniqueOrThrow({where: {id: scoped.id}})).role, 'USER');
    const unverifiedSchoolLogin = await login(token('school-' + tag, schoolEmail, false));
    assert.ok(unverifiedSchoolLogin.status >= 400 && unverifiedSchoolLogin.status < 500);
    assert.equal(await db.session.count({where: {userId: scoped.id}}), 0);
    const schoolLogin = await login(token('school-' + tag, schoolEmail, true));
    assert.equal(schoolLogin.status, 200, await schoolLogin.clone().text());
    const schoolCookie = cookieOf(schoolLogin);
    const {GET: globalRead} = await import('../src/app/api/resources/[resource]/route');
    assert.equal((await globalRead(new Request(origin+'/api/resources/users',{headers:{cookie:schoolCookie}}),{params:Promise.resolve({resource:'users'})})).status,403);
    const {GET: schoolRead} = await import('../src/app/api/schools/[id]/route');
    const {POST: schoolTeam} = await import('../src/app/api/schools/[id]/admins/route');
    const read = (id: string) => schoolRead(new Request(origin + '/api/schools/' + id, {headers: {cookie: schoolCookie}}), {params: Promise.resolve({id})});
    assert.equal((await read(a.id)).status, 200);
    assert.equal((await read(b.id)).status, 403);
    assert.equal((await add({email: emails[2]}, schoolCookie)).status, 403, 'school managers cannot grant global access');
    const teamEmail = 'team-' + tag + '@example.test'; emails.push(teamEmail);
    const teamAdd = await schoolTeam(new Request(origin + '/api/schools/' + a.id + '/admins', {method: 'POST', headers: {origin, cookie: schoolCookie, 'content-type': 'application/json'},
      body: JSON.stringify({email: teamEmail})}), {params: Promise.resolve({id: a.id})});
    assert.equal(teamAdd.status, 200, await teamAdd.clone().text()); ids.push((await teamAdd.json()).id);
    await grantSchool(ownerId, b.id, {email: schoolEmail});
    await grantSchool(ownerId, a.id, {email: schoolEmail, revoke: true});
    assert.equal((await read(a.id)).status, 403, 'one school can be revoked independently');
    assert.equal((await read(b.id)).status, 200);
    await grantSchool(ownerId, b.id, {email: schoolEmail, revoke: true});
    assert.equal((await read(b.id)).status, 401, 'last-scope revocation invalidates a still-valid admin cookie');
    assert.equal((await login(token('school-' + tag, schoolEmail, true))).status, 403);
    await setUserRole(invited.id, 'USER', ownerId);
    assert.equal(await db.session.count({where: {userId: invited.id}}), 0);
    assert.equal((await login(token('google-' + invited.id, emails[0], true))).status, 403);
    assert.equal((await add({email: emails[2]}, cookieOf(invitedLogin))).status, 401, 'revocation also invalidates existing API access');
    await db.user.update({where: {id: ownerId}, data: {bannedAt: new Date()}});
    await assert.rejects(addAdminByEmail(ownerId, {email: emails[2]}), /OWNER_ONLY/);
    const unknownEmail = 'unknown-' + tag + '@example.test';
    const unknown = await login(token('unknown-' + tag, unknownEmail, true), true);
    assert.equal(unknown.status, 403, await unknown.clone().text());
    assert.equal(await db.user.count({where: {email: unknownEmail}}), 0);
    const authorization = await POST(new Request(origin + '/api/auth/sign-in/social', {method: 'POST', headers: {origin, 'content-type': 'application/json', 'x-forwarded-for': '10.17.18.19'},
      body: JSON.stringify({provider: 'google', callbackURL: '/', disableRedirect: true})}));
    assert.equal(authorization.status, 200);
    const url = new URL((await authorization.json()).url);
    assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/callback/google');
    const state = url.searchParams.get('state');
    if (state) await db.verification.deleteMany({where: {identifier: state}});
    for (const path of ['/sign-up/email', '/link-social', '/change-password', '/update-user', '/callback/microsoft']) {
      const denied = await POST(new Request(origin + '/api/auth' + path, {method: 'POST'}));
      assert.equal(denied.status, 404, path);
    }
    const callback = await GET(new Request(origin + '/api/auth/callback/google?error=access_denied'));
    assert.notEqual(callback.status, 404, 'Google callbacks must reach the auth handler');
    assert.equal(new URL(callback.headers.get('location')!).pathname, '/login');
  } finally {
    globalThis.fetch = originalFetch;
    await db.profile.deleteMany({where: {id: {in: schools}}});
    await db.auditLog.deleteMany({where: {OR: [{actorUserId: {in: ids}}, {targetId: {in: ids}}]}});
    await db.user.deleteMany({where: {OR: [{id: {in: ids}}, {email: {in: [...emails, ...emails.map(email => email.toUpperCase()), 'unknown-' + tag + '@example.test']}}]}});
    await db.$disconnect();
  }
});
