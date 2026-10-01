# Operations

Health endpoints, logs, alerts, backups and the restore procedure. Hosting is Railway (web, admin and worker from one repository — see [deployment](deployment.md) and the [worker runbook](worker.md)). Everything here has been exercised by the test-suite against local Postgres, Redis and disk storage; nothing has been exercised against a live Railway project, a real S3 bucket, a real webhook or a real `pg_dump` (see "Not verified" at the end).

## Health endpoints

| Endpoint | Meaning | 200 | 503 |
| --- | --- | --- | --- |
| `GET /api/health` | Liveness: the web process answers. Use it as Railway's deploy healthcheck. | always | — |
| `GET /api/health/ready` | Readiness: this process reaches the database and Redis. | `{"status":"ok","database":"ok","redis":"ok"}` (`"redis":"disabled"` when `REDIS_URL` is not set) | `{"status":"unavailable", …}` with `"down"` for the failing dependency |
| `GET /api/health/worker` | A worker refreshed its heartbeat within the last 90 s. | `{"status":"ok","at":…}` | `{"status":"down"}` |

The bodies carry no hostnames, connection strings, versions or error texts. Point an external uptime monitor at `/api/health/ready` and `/api/health/worker`; Railway's own healthcheck only runs while a deployment starts.

## Logs

Every line the application writes is one JSON object on stdout/stderr with at least `level` (`info`, `warn`, `error`) and `event`. Worker lines add `service: "worker"`. Fields worth filtering on:

| event | fields | meaning |
| --- | --- | --- |
| `request_error` | `message`, `path` (no query string), `method`, `route` | unhandled error in a request; also forwarded to `SENTRY_DSN` when set |
| `slow_query` | `ms`, `thresholdMs`, `sql`, `suppressed` | a database query at or above `SLOW_QUERY_MS` |
| `job_started` / `job_completed` / `job_failed` / `job_dead` | `job`, `id`, `attempt`, `ms`, `result`, `message` | worker job lifecycle; `job_dead` = the last attempt failed |
| `alert_sent` / `alert_undelivered` | `kind`, `delivered`, `details` | an alert went out (or could not be delivered) |
| `import_source` | `sourceId`, `kind`, `ok`, `error`, `counts` | one importer run; `counts` may hold `IMPORTED`, `UPDATED`, `CANCELLED`, `REVIEW`, `MISSING`, `DUPLICATE`, `REJECTED`, `SKIPPED`, `FAILED` |
| `embed_refresh` / `embed_refresh_refused` | `candidates`, `refreshed`, `copied`, `gone`, `failed`, `stopped`, `status`, `pauseSec` | Instagram card refresh |
| `media_orphans`, `media_purge_failed` | `scanned`, `images`, `orphans`, `deleted`, `capped`, `sample` | storage hygiene |
| `backup_completed` / `backup_failed` / `backup_skipped` | `key`, `bytes`, `ms`, `kept`, `pruned`, `message`, `reason`, `hint` | database backup |

Logs never contain passwords, tokens, e-mail addresses, the alert webhook URL or query strings.

### Slow-query tracing

`packages/db/src/index.ts` listens to Prisma's query events and logs every query that takes `SLOW_QUERY_MS` milliseconds or more (default 500; `0` switches tracing off — the events are then not produced at all). The SQL text is logged on one line, cut to 300 characters, with string literals and long numbers masked; bound parameter values are never logged. At most `SLOW_QUERY_LOGS_PER_MIN` lines (default 30) per process and minute; the number held back appears as `suppressed` on the next line. It applies to web, admin and worker, which all use `@dance/db`.

## Alerts

No external monitoring service is required. Two counters live in Redis as sliding 5-minute windows: unhandled request errors (`instrumentation.ts` → `onRequestError`) and jobs that failed their last attempt (worker). A watchdog compares them with the thresholds and checks the worker heartbeat, the database, Redis and the last backup. It runs in two places, because neither process can report its own death:

- worker job `ops.watchdog`, every minute;
- a timer in the web process (started from `instrumentation.ts` `register()`, only when an alert target is configured; one web instance per minute does the work).

| Alert | Raised when |
| --- | --- |
| `errors` | request errors in 5 minutes ≥ `ALERT_ERRORS_PER_5MIN` (default 20) |
| `jobs` | jobs failed for good in 5 minutes ≥ `ALERT_JOB_FAILURES_PER_5MIN` (default 5) |
| `worker_down` | no valid worker heartbeat for more than 3 minutes |
| `database_down`, `redis_down` | the dependency does not answer within 2 s |
| `backup_failed` | `BACKUP_ENABLED=true` and the last backup run failed (including "pg_dump is not installed") |
| `backup_stale` | `BACKUP_ENABLED=true` and no successful backup for 36 hours |

Each kind is sent at most once per `ALERT_COOLDOWN_MIN` (default 30) across all processes; an alert that could not be delivered does not use up the cooldown.

| Variable | Purpose |
| --- | --- |
| `ALERT_WEBHOOK_URL` | Receives `POST` with JSON `{"text": "[host] …", "kind", "at", "details"}`. Works as a Slack / Mattermost incoming webhook. For Telegram use `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>` — the body is then `{"text", "chat_id"}`. Treat the URL as a secret. |
| `ALERT_EMAIL` | Address that receives the same text through the site's SMTP settings (`SMTP_*`). |
| `ALERT_ERRORS_PER_5MIN`, `ALERT_JOB_FAILURES_PER_5MIN`, `ALERT_COOLDOWN_MIN` | Thresholds and cooldown. |

Set the variables on both the web and the worker service. With neither target set, problems are still visible in `ops.watchdog` results (`job_completed … "problems":[…]`) but nothing is sent. If Redis itself is down each process falls back to its own in-memory counters and cooldown. An e-mail alert about a broken SMTP server will of course not arrive — prefer the webhook, or configure both.

## Backups

Requirement: nightly backups, kept for 30 days, with a restore check.

1. **Primary: Railway volume backups** of the Postgres service. Enable the daily schedule in the service's Backups tab and keep at least 30 days. This is platform configuration, not code.
2. **Fallback, independent of the platform: job `backup.database`** (worker, 02:40 UTC, off unless `BACKUP_ENABLED=true`). It runs `pg_dump --format=custom --no-owner --no-privileges`, checks that the archive is readable (`pg_restore --list`), stores it as `backups/YYYY/MM/DD/<database>-<UTC timestamp>.dump` through the storage driver and then deletes dumps older than `BACKUP_RETENTION_DAYS` (default 30). Pruning happens only after a successful upload. The outcome is recorded for the watchdog.

| Variable | Purpose |
| --- | --- |
| `BACKUP_ENABLED=true` | Switches the job on (worker service). |
| `BACKUP_RETENTION_DAYS` | Days to keep, default 30. |
| `BACKUP_S3_BUCKET` | Separate private bucket for dumps (same endpoint and credentials as media). Recommended. |
| `BACKUP_PUBLIC_BUCKET_OK=true` | Only when dumps share the media bucket *and* `S3_PUBLIC_URL` is set: confirms that the bucket's public-read policy covers `img/*` only. Without it the job refuses to upload (`BACKUP_BUCKET_IS_PUBLIC`). |
| `PG_BIN_DIR` | Directory with `pg_dump` / `pg_restore` when they are not on `PATH`. |

Requirements and limits:

- The worker image needs the PostgreSQL client tools, of the server's major version or newer. Railpack does not install them by default; add the package to the worker service (for example through `RAILPACK_DEPLOY_APT_PACKAGES=postgresql-client`, or a matching versioned package) and check the `backup_completed` line after the first night. Without the binary the job logs `backup_skipped` with `reason: "PG_DUMP_MISSING"`, records a failure (→ `backup_failed` alert) and does nothing else.
- Dumps are never reachable over HTTP: the media route serves only `img/<profile>/<uuid>/<width>.<format>` keys, the upload route only writes `raw/…` (covered by a test). With S3, that guarantee is the bucket policy's — keep `backups/` private.
- With the local disk driver the dump lands on the same volume as the media (`MEDIA_LOCAL_DIR/backups/`): it protects against a lost database, not against a lost volume. Use S3 for real off-site copies.
- The connection settings are passed to `pg_dump` through the environment (`PGHOST`, `PGPASSWORD`, …), never on the command line.
- A dump that takes longer than 15 minutes outlives the worker's per-job run lock; the next scheduled run is a day away, so runs do not overlap in practice.
- Run one by hand: `pnpm worker --once backup.database` (with `BACKUP_ENABLED=true`).

### Restore runbook

A custom-format dump is restored with `pg_restore`. The database uses PostGIS (`geography` columns) and `pg_trgm`; the extensions must exist **before** the data is restored, and creating them needs a role that is allowed to (on managed Postgres usually the default owner).

```sh
# 1. Fetch the dump (S3 example; with local storage copy it from MEDIA_LOCAL_DIR/backups/…)
aws s3 cp s3://<bucket>/backups/2026/10/01/railway-20261001T024007Z.dump ./restore.dump

# 2. Look inside before touching any database
pg_restore --list ./restore.dump | head -40

# 3. Create an empty target and the extensions, in this order
createdb "$TARGET_DB"
psql "$TARGET_DB" -c 'CREATE EXTENSION IF NOT EXISTS postgis;' -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
#    (check prisma/migrations for the authoritative list: grep -ri "create extension" packages/db/prisma/migrations)

# 4. Restore. --no-owner/--no-privileges: objects belong to the connecting role.
pg_restore --no-owner --no-privileges --jobs=4 --dbname="$TARGET_DB" ./restore.dump
#    "extension already exists" notices are expected; any other error is not.

# 5. Verify
psql "$TARGET_DB" -c 'SELECT count(*) FROM "User";' -c 'SELECT count(*) FROM "Event";' \
  -c 'SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 1;' \
  -c 'SELECT postgis_version();' -c 'SELECT count(*) FROM "Event" WHERE geo IS NOT NULL;'
```

To put a restored database into service: stop web and worker, point `DATABASE_URL` at it, run `pnpm release:railway` (applies migrations newer than the dump; never `migrate reset` or `db push`), start web, then the worker. Media files are not part of the dump: rows may point at images uploaded after the object store's own state, or the other way round — run `pnpm worker --once media.orphans` with `MEDIA_ORPHAN_DRY_RUN=true` afterwards to see the difference.

### Quarterly restore test

Once a quarter, and after every change of the Postgres major version:

1. Take the newest dump (and, separately, restore the newest Railway volume backup into a scratch service).
2. Restore it into a scratch database following steps 1–5 above; never into production.
3. Compare the counts of step 5 with production (they may differ by one day of activity) and the last migration name with `packages/db/prisma/migrations`.
4. Start the web app locally against the scratch database (`DATABASE_URL=… pnpm dev`) and open the home page, one event and the map.
5. Note the date, the dump used, the duration and anything that went wrong in the team's operations log; drop the scratch database.

## Storage hygiene

| Job | Schedule | What it does |
| --- | --- | --- |
| `media.sweep` | daily 04:15 UTC | deletes raw uploads never completed, older than a day |
| `media.purge` | every 15 min | deletes the stored files of media removed in the admin panel (it finds the `AuditLog` rows `TARGET_DELETE` with `data.mediaKey` of the last 30 days and writes a `MEDIA_PURGED` row per handled entry; keys still referenced elsewhere are kept) |
| `media.orphans` | daily 04:45 UTC | deletes processed images under `img/` older than 7 days that no `MediaItem`, avatar, cover or chat attachment references; at most `MEDIA_ORPHAN_MAX` (500) images per run; `MEDIA_ORPHAN_DRY_RUN=true` only reports (`media_orphans` log line) |

Web and worker must see the same object store; with the local driver that means the same volume.

## Not verified

- Railway: no service, variable, healthcheck path or backup schedule was created or checked; whether the Railpack variable above installs a matching `pg_dump` is an assumption to confirm on the first run.
- `pg_dump` / `pg_restore`: not installed on the development machine; the job was tested with a stand-in dump function, and the restore commands above were not executed.
- S3: `list` and `putFile` of the S3 driver are written against the SDK and type-checked but were not run against a bucket.
- Alert delivery: tested with a stand-in HTTP client and mail function, not against Slack, Telegram or a real SMTP relay.
- The web process's watchdog timer and the request-error counter hook were unit-tested, not observed inside a running Next.js server.
