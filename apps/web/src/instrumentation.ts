// Server error reporting. Every unhandled request error is logged as structured JSON and, when SENTRY_DSN points
// at a GlitchTip (or Sentry) project, forwarded through the Sentry envelope protocol — no SDK needed.
type RequestInfo = {path: string; method: string};
type ErrorContext = {routePath?: string; routeType?: string};
function endpoint(dsn: string) {
  try {
    const url = new URL(dsn), project = url.pathname.replace(/^\/+/, '');
    if (!url.username || !project) return null;
    return {url: url.protocol + '//' + url.host + '/api/' + project + '/envelope/', key: url.username};
  } catch {return null;}
}
// Node.js server only: the modules behind these imports (Redis, Prisma, SMTP) do not exist in the Edge runtime, and the
// literal comparison lets the bundler drop the branch there.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // The worker cannot report its own death, so the web process watches the heartbeat as well (lib/ops/alerts.ts).
    const {startWebWatchdog} = await import('./lib/ops/alerts');
    startWebWatchdog();
  }
}
export async function onRequestError(error: unknown, request: RequestInfo, context: ErrorContext) {
  const err = error instanceof Error ? error : new Error(String(error));
  // The query string may carry tokens (invites, unsubscribe): only the path is recorded.
  const path = request.path.split('?')[0];
  console.error(JSON.stringify({level: 'error', event: 'request_error', message: err.message, path, method: request.method, route: context.routePath}));
  // Counted for the error-rate alert; a failure to count must never mask the original error.
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./lib/ops/alerts').then(ops => ops.recordError('request')).catch(() => undefined);
  const target = process.env.SENTRY_DSN ? endpoint(process.env.SENTRY_DSN) : null;
  if (!target) return;
  const eventId = crypto.randomUUID().replace(/-/g, ''), sentAt = new Date().toISOString();
  const event = {event_id: eventId, timestamp: Date.now() / 1000, platform: 'node', level: 'error',
    environment: process.env.NODE_ENV, server_name: 'web', transaction: context.routePath,
    exception: {values: [{type: err.name, value: err.message, stacktrace: {frames: (err.stack || '').split('\n').slice(1, 30).reverse()
      .map(line => ({filename: line.trim()}))}}]},
    request: {url: path, method: request.method}};
  const body = [JSON.stringify({event_id: eventId, sent_at: sentAt, dsn: process.env.SENTRY_DSN}),
    JSON.stringify({type: 'event'}), JSON.stringify(event)].join('\n');
  await fetch(target.url, {method: 'POST', signal: AbortSignal.timeout(3000),
    headers: {'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': 'Sentry sentry_version=7, sentry_key=' + target.key},
    body}).catch(() => undefined);
}
