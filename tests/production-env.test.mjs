import test from 'node:test';
import assert from 'node:assert/strict';
import {productionProblems} from '../scripts/check-production-env.mjs';
const env = {DATABASE_URL: 'postgresql://user:password@postgres.railway.internal/bailamos', BETTER_AUTH_SECRET: 'a'.repeat(48), RAILPACK_PRUNE_DEPS: 'false', BETTER_AUTH_URL: 'https://bailamos.me', REDIS_URL: 'redis://redis.railway.internal:6379', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_FROM: 'Bailamos <hello@bailamos.me>', MEDIA_STORAGE: 's3', S3_BUCKET: 'bailamos-media', S3_ACCESS_KEY: 'fixture-key', S3_SECRET_KEY: 'fixture-secret'};
test('production deployment accepts shared S3 storage and complete OAuth aliases', () => {
  assert.deepEqual(productionProblems({...env, CLIENT_ID_GOOGLE: 'fixture-client', CLIENT_SECRET_GOOGLE: 'fixture-secret'}), []);
  assert.deepEqual(productionProblems({...env, ADMIN_URL: 'https://admin.bailamos.me', WEB_URL: 'https://bailamos.me'}, 'admin'), []);
});
test('deployment rejects local dependencies, ephemeral storage and incomplete credentials without exposing values', () => {
  const problems = productionProblems({...env, DATABASE_URL: 'postgresql://user:do-not-print@localhost/db', MEDIA_STORAGE: 'local', SMTP_HOST: 'mailpit', CLIENT_ID_GOOGLE: 'do-not-print', APPLE_CLIENT_ID: 'do-not-print'});
  assert.ok(problems.some(value => value.includes('DATABASE_URL')));
  assert.ok(problems.some(value => value.includes('MEDIA_STORAGE')));
  assert.ok(problems.some(value => value.includes('SMTP_HOST')));
  assert.ok(problems.some(value => value.includes('GOOGLE')));
  assert.ok(problems.some(value => value.includes('APPLE')));
  assert.ok(!problems.join().includes('do-not-print'));
});
