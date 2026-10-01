// Redis keys written by the worker process. Importing this file has no side effects, so the web app can read them
// (e.g. /api/health/worker validates the heartbeat timestamp as well as key existence).
/** JSON {at, pid, host, queue, jobs}; refreshed every HEARTBEAT_EVERY_MS with a TTL of HEARTBEAT_TTL_SEC. */
export const HEARTBEAT_KEY = 'worker:heartbeat', HEARTBEAT_TTL_SEC = 90, HEARTBEAT_EVERY_MS = 30_000;
/** Redis list (newest first, capped at DEAD_LETTER_MAX) of JSON {at, queue, job, id, attempts, message}: jobs that failed their last attempt. */
export const DEAD_LETTER_KEY = 'worker:dead', DEAD_LETTER_MAX = 500;
