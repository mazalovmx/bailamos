import {pathToFileURL, URL} from 'node:url';
// Run in Railway's environment. Never prints credentials or reads local .env.
export function productionProblems(env, service = 'web') {
  const problems = [];
  const required = names => names.forEach(name => {if (!env[name]?.trim()) problems.push(`${name} is required`);});
  const https = name => {
    try { const url = new URL(env[name]); if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.pathname !== '/' || url.search || url.hash) throw new Error(); }
    catch { problems.push(`${name} must be a public HTTPS origin`); }
  };
  required(['DATABASE_URL', 'BETTER_AUTH_SECRET']);
  if ((env.BETTER_AUTH_SECRET || '').length < 32 || /replace|generate|ci-only/i.test(env.BETTER_AUTH_SECRET || '')) problems.push('BETTER_AUTH_SECRET must be a unique secret of at least 32 characters');
  try {const url = new URL(env.DATABASE_URL); if (!['postgres:', 'postgresql:'].includes(url.protocol) || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();}
  catch {problems.push('DATABASE_URL must reference production PostgreSQL');}
  if (env.RAILPACK_PRUNE_DEPS !== 'false') problems.push('RAILPACK_PRUNE_DEPS must be false');
  if (service === 'admin') {required(['ADMIN_URL', 'WEB_URL']); https('ADMIN_URL'); https('WEB_URL'); return problems;}
  required(['BETTER_AUTH_URL', 'REDIS_URL']);
  if (env.EMAIL_AUTH_ENABLED !== undefined && !['true', 'false'].includes(env.EMAIL_AUTH_ENABLED)) problems.push('EMAIL_AUTH_ENABLED must be true or false');
  const needsMail = service === 'worker' || env.EMAIL_AUTH_ENABLED !== 'false';
  if (needsMail) required(['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM']);
  https('BETTER_AUTH_URL');
  try {const url = new URL(env.REDIS_URL); if (!['redis:', 'rediss:'].includes(url.protocol) || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();}
  catch {problems.push('REDIS_URL must reference production Redis');}
  if (needsMail && ['localhost', '127.0.0.1', 'mailpit'].includes(env.SMTP_HOST)) problems.push('SMTP_HOST must use a real mail provider');
  if (needsMail && !['true', 'false'].includes(env.SMTP_SECURE)) problems.push('SMTP_SECURE must be true or false');
  if (needsMail && (!/^\d+$/.test(env.SMTP_PORT || '') || +env.SMTP_PORT < 1 || +env.SMTP_PORT > 65535)) problems.push('SMTP_PORT is invalid');
  // Web and worker cannot share a Railway volume. Use the same object store.
  if (env.MEDIA_STORAGE !== 's3') problems.push('MEDIA_STORAGE must be s3 for the web/worker deployment');
  required(['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']);
  for (const provider of ['GOOGLE', 'MICROSOFT']) {
    const pairs = [[`${provider}_CLIENT_ID`, `${provider}_CLIENT_SECRET`], [`CLIENT_ID_${provider}`, `CLIENT_SECRET_${provider}`]];
    if (pairs.some(pair => pair.some(key => env[key]?.trim())) && !pairs.some(pair => pair.every(key => env[key]?.trim()))) problems.push(`${provider} OAuth credentials are incomplete`);
  }
  const apple = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'];
  if (apple.some(key => env[key]?.trim()) && !apple.every(key => env[key]?.trim())) problems.push('APPLE OAuth credentials are incomplete');
  return problems;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = process.argv[2] || 'web';
  if (!['web', 'worker', 'admin'].includes(service)) throw new Error('Use web, worker or admin');
  const problems = productionProblems(process.env, service);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
  else console.log(`Production configuration for ${service}: OK (connectivity is checked separately)`);
}
