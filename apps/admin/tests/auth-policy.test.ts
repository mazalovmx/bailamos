import test from 'node:test';
import assert from 'node:assert/strict';
import {adminGoogleCredentials, mayEnterAdmin} from '../src/lib/auth-policy';

test('admin Google credentials require a complete pair and support both env conventions', () => {
  assert.equal(adminGoogleCredentials({}), null);
  assert.equal(adminGoogleCredentials({GOOGLE_CLIENT_ID: 'id'}), null);
  assert.equal(adminGoogleCredentials({GOOGLE_CLIENT_ID: 'id', CLIENT_SECRET_GOOGLE: 'secret'}), null);
  assert.deepEqual(adminGoogleCredentials({CLIENT_ID_GOOGLE: ' id ', CLIENT_SECRET_GOOGLE: ' secret '}), {clientId: 'id', clientSecret: 'secret'});
  assert.deepEqual(adminGoogleCredentials({GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret'}), {clientId: 'id', clientSecret: 'secret'});
});

test('admin sessions require an existing verified staff account and deny bans and ordinary users', () => {
  assert.equal(mayEnterAdmin(null), false);
  for (const role of ['OWNER', 'ADMIN', 'MODERATOR', 'SCHOOL_ADMIN']) {
    assert.equal(mayEnterAdmin({role, bannedAt: null, emailVerified: true}), true);
    assert.equal(mayEnterAdmin({role, bannedAt: new Date(), emailVerified: true}), false);
    assert.equal(mayEnterAdmin({role, bannedAt: null, emailVerified: false}), false);
  }
  for (const role of ['USER', 'UNKNOWN', '']) assert.equal(mayEnterAdmin({role, bannedAt: null, emailVerified: true}), false);
});
