import {readiness} from '../../../../lib/ops/alerts';
// Readiness for Railway and uptime monitors: 200 only when this process reaches the database and (when configured)
// Redis; 503 otherwise. The body names the failing dependency and nothing else — no hosts, versions or error texts.
// /api/health stays the liveness probe (the process answers), /api/health/worker the worker heartbeat.
export const dynamic = 'force-dynamic';
export async function GET() {
  const checks = await readiness();
  const ok = checks.database === 'ok' && checks.redis !== 'down';
  return Response.json({status: ok ? 'ok' : 'unavailable', ...checks}, {status: ok ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
}
