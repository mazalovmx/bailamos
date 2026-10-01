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

Registry: `apps/web/src/worker/registry.ts`. Jobs cover weekly digests, event reminders, media cleanup, rate-limit maintenance, external imports, Instagram card refresh, the alert watchdog and the optional database backup (table below). `WORKER_JOBS` optionally limits enabled jobs. `WORKER_QUEUE` defaults to `dance-jobs`; `WORKER_CONCURRENCY` defaults to 2.

## Jobs

| Job | Schedule (UTC) | Purpose |
| --- | --- | --- |
| `digest.weekly` | Monday 07:00 | weekly e-mail digest |
| `reminders.events` | every 5 min | event reminders |
| `media.sweep` | daily 04:15 | abandoned raw uploads |
| `media.purge` | every 15 min | files of media deleted in the admin panel (`AuditLog` `TARGET_DELETE` → `MEDIA_PURGED`) |
| `media.orphans` | daily 04:45 | unreferenced processed images older than 7 days; `MEDIA_ORPHAN_DRY_RUN=true` reports only, `MEDIA_ORPHAN_MAX` caps a run |
| `ratelimit.cleanup` | daily 03:30 | stale counters, tokens, read notifications, expired invites |
| `import.sources` | every 30 min | due import sources (see below) |
| `import.source` | on demand | one source (`{sourceId, force?}`) |
| `import.news.prune` | daily 04:17 | news older than 90 days |
| `embeds.refresh` | every 30 min | Instagram oEmbed copies older than ~20 h |
| `ops.watchdog` | every minute | error rates, heartbeat, database, Redis, backup freshness → alerts |
| `backup.database` | daily 02:40 | `pg_dump` to the object store; only with `BACKUP_ENABLED=true` |

Alerts, backups, restore and log fields are described in [operations](operations.md).

### Importer: following the source

An imported event keeps following its feed entry. On every run an already imported item is compared with the entry (content hash of title, text, place, link and schedule; dates that simply passed and a weekly series rolling forward are not changes):

- changed, and the event is still exactly what the importer wrote (no organizer or school, `Event.updatedAt` equal to the timestamp stored in `ImportedItem.payload.sync.writtenAt`) → the event and its upcoming dates are rewritten (`UPDATED`); past dates and people's answers stay;
- changed, but somebody claimed or edited the event → nothing is written; the item goes to `REVIEW` with a note such as `SOURCE_CHANGED title: "A" → "B"; time: … → …`. Approving it in the admin panel applies the source's version to that same event; rejecting keeps the human version (the item then stops following the source);
- marked cancelled (iCal `STATUS:CANCELLED`, Schema.org `eventStatus: EventCancelled`) → the event becomes `CANCELLED` and people who answered get the standard cancellation notice once; a claimed or edited event goes to review instead (`SOURCE_CANCELLED`);
- no longer listed in `IMPORT_MISSING_RUNS` (default 3) consecutive complete listings → the same as cancelled (`GONE_FROM_SOURCE`, or review `SOURCE_GONE`). Only iCal and Schema.org listings that were read completely count; RSS (a window of recent entries), an empty answer, a failed fetch, "not modified" and a listing cut at the per-run limit prove nothing. Past events are left alone.

Limits: a time change does not notify attendees (only a cancellation does); a cancelled item does not come back by itself if the source un-cancels it; an address is geocoded once and not again while it stays the same.

`robots.txt` is honoured for Schema.org page sources (our product token, then `*`; longest match, Allow on a tie; cached per host for 24 h, 1 h when the file could not be reached, in which case the page is not fetched). RSS and iCal feeds published for syndication are fetched regardless. Every request, including `robots.txt`, respects the per-host pause.

### Instagram cards

`embeds.refresh` re-asks oEmbed for posts whose stored copy is older than ~20 hours: at most `EMBED_REFRESH_BATCH` (25) posts per pass and `EMBED_REFRESH_PER_HOUR` (120) upstream requests per hour over all workers, one request per post per day. A 404 keeps the last good card and the link and marks the rows `gone` in `embedMeta`; nothing is deleted. 429 or another 4xx pauses all workers (15 min, doubling up to 6 h); three network failures in a row end the pass. Answers update every `MediaItem` of the post (events and blog posts alike) and warm the Redis cache pages read from.

## Railway service

Create a separate worker service from the same repository and `deploy` branch, with root `/` and config path `/railway.worker.json`. Share `DATABASE_URL`, `REDIS_URL`, the same auth/signing secrets, SMTP and required media/integration configuration with web. Set `RAILPACK_PRUNE_DEPS=false` so Prisma/tsx remain available. No public domain is needed.

Deploy the web service's migrations before starting a worker that requires the new schema. The worker config deliberately does not run an independent migration/seed stage. Coordinate compatible web/worker releases; do not assume two services deploy in a particular order automatically. Local media storage requires access to the same persistent files; S3 is preferable when services run separately.

No Railway service is created just by committing this file. Credentials and actual provisioning remain deployment work.

## Health and failure handling

The worker refreshes a Redis heartbeat every 30 seconds with a 90-second TTL. `/api/health/worker` on web returns 200 only for a parseable recent heartbeat, or 503 when missing, stale, malformed or implausibly far in the future. It returns no hostnames, process IDs or credentials. `/api/health` remains web-process liveness.

`/api/health/ready` reports database and Redis reachability. The `ops.watchdog` job and a timer in the web process send alerts to `ALERT_WEBHOOK_URL` / `ALERT_EMAIL` when error rates cross their thresholds or the heartbeat is missing for more than 3 minutes (see [operations](operations.md)); an external uptime monitor on the 503 responses is still worth having. A stopped worker can appear healthy until its last heartbeat expires. A shared heartbeat proves at least one worker is alive, not that every job/service is healthy.

Jobs log structured JSON, retry failures and keep a bounded dead-letter list. Shutdown stops new work and waits for active handlers, with a bounded timeout. The feature tests exercise the registry, one-shot jobs and real Redis queue startup/shutdown. CI must supply Redis; otherwise the queue smoke test is skipped.
