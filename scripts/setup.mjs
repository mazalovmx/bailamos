import {randomBytes} from 'node:crypto';
import {existsSync, writeFileSync, readFileSync, appendFileSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
const path = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(path)) {
  console.log('Preserving existing environment values.');
} else {
  const db = randomBytes(24).toString('hex');
  const storage = randomBytes(24).toString('hex');
  writeFileSync(path, [
    'POSTGRES_USER=dance', 'POSTGRES_DB=dance', 'POSTGRES_PASSWORD=' + db,
    'DATABASE_URL=postgresql://dance:' + db + '@127.0.0.1:54329/dance',
    'REDIS_URL=redis://127.0.0.1:63799', 'MINIO_ROOT_USER=dance-local',
    'MINIO_ROOT_PASSWORD=' + storage, 'S3_ENDPOINT=http://127.0.0.1:9000',
    'S3_BUCKET=dance-media', ''
  ].join('\n'), {flag: 'wx', mode: 0o600});
  console.log('Created .env with unique local credentials.');
}
const existing = readFileSync(path, 'utf8');
const additions = {
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Dance Community <hello@dance.local>'
};
for (const [key, value] of Object.entries(additions)) {
  if (!new RegExp('^' + key + '=', 'm').test(existing)) appendFileSync(path, '\n' + key + '=' + value + '\n');
}
console.log('Auth and local SMTP settings are present.');
