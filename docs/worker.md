# Background worker

The worker uses the same repository, Prisma schema and database as web. It is a separate process, not an HTTP server. Redis is required for queue mode.

```sh
pnpm worker --list
pnpm worker
# Run a single maintenance job without scheduling the queue:
pnpm worker --once ratelimit.cleanup
# Bounded local smoke run:
pnpm worker --exit-after 10
```

Registry: `apps/web/src/worker/registry.ts`. Jobs cover weekly digests, event reminders, media cleanup, rate-limit maintenance and external imports. `WORKER_JOBS` optionally limits enabled jobs. `WORKER_QUEUE` defaults to `dance-jobs`; `WORKER_CONCURRENCY` defaults to 2.

## Railway service

Create a separate worker service from the same repository and `deploy` branch, with root `/` and config path `/railway.worker.json`. Share `DATABASE_URL`, `REDIS_URL`, the same auth/signing secrets, SMTP and required media/integration configuration with web. Set `RAILPACK_PRUNE_DEPS=false` so Prisma/tsx remain available. No public domain is needed.

Deploy the web service's migrations before starting a worker that requires the new schema. The worker config deliberately does not run an independent migration/seed stage. Coordinate compatible web/worker releases; do not assume two services deploy in a particular order automatically. Local media storage requires access to the same persistent files; S3 is preferable when services run separately.

No Railway service is created just by committing this file. Credentials and actual provisioning remain deployment work.

## Health and failure handling

The worker refreshes a Redis heartbeat every 30 seconds with a 90-second TTL. `/api/health/worker` on web returns 200 only for a parseable recent heartbeat, or 503 when missing, stale, malformed or implausibly far in the future. It returns no hostnames, process IDs or credentials. `/api/health` remains web-process liveness.

An uptime monitor should alert on sustained 503 responses; this repository does not provision an external alert service. A stopped worker can appear healthy until its last heartbeat expires. A shared heartbeat proves at least one worker is alive, not that every job/service is healthy.

Jobs log structured JSON, retry failures and keep a bounded dead-letter list. Shutdown stops new work and waits for active handlers, with a bounded timeout. The feature tests exercise the registry, one-shot jobs and real Redis queue startup/shutdown. CI must supply Redis; otherwise the queue smoke test is skipped.
