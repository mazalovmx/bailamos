import {HEARTBEAT_TTL_SEC} from './keys';
// Redis availability alone is not evidence that the worker is running.
export function workerHeartbeat(raw: string | null | undefined, now = Date.now()): {status: 'ok'; at: string} | {status: 'down'} {
  if (!raw) return {status: 'down'};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('at' in value) || typeof value.at !== 'string') return {status: 'down'};
    const time = Date.parse(value.at), age = now - time;
    // Allow a little clock skew between the web and worker hosts, not arbitrary future timestamps.
    if (!Number.isFinite(time) || age < -5000 || age >= HEARTBEAT_TTL_SEC * 1000) return {status: 'down'};
    return {status: 'ok', at: new Date(time).toISOString()};
  } catch { return {status: 'down'}; }
}
