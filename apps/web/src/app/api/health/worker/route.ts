import {withRedis} from '../../../../lib/redis';
import {HEARTBEAT_KEY} from '../../../../worker/keys';
import {workerHeartbeat} from '../../../../worker/health';
// Readiness of the background worker: 503 when no worker refreshed its heartbeat, so an uptime monitor can alert.
export const dynamic = 'force-dynamic';
export async function GET() {
  const raw = await withRedis(redis => redis.get(HEARTBEAT_KEY));
  const health = workerHeartbeat(raw);
  return Response.json(health, {status: health.status === 'ok' ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
}
