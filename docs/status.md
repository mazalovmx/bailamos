# Delivery status — October 1, 2026

Branch: `feature/requirements-completion`. This page describes the current working tree. Local checks do not imply that Railway or external providers have been configured. See [the detailed audit](implementation.md).

## Current acceptance checks

Final verification: ESLint and both production builds passed. Root `pnpm test` passed all 209 checks (198 web, 8 admin, 3 translations), with no failures or skips. The separate HTTP account/event workflow also passed. Logs are local ignored artifacts in `test-results/acceptance-*.log` and `test-results/resume-*.log`.

- The homepage explains event discovery, dance profiles and community publishing. At 360 px both primary calls to action are visible on the first screen.
- City/style search fields are full-width text inputs rather than checkbox-sized boxes. Browser checks entered Madrid and Lindy, selected two cities and two styles, and preserved the selections when switching to Russian.
- All six homepage photographs loaded as static responsive WebP assets (approximately 43–163 KB per image variant).
- Owner sign-in works in the administrative panel, including access to school administration.
- The account dashboard is available at /en/account. Ordinary sign-in now defaults to it while preserving explicitly requested return paths.
- All ten public navigation links were clicked successfully on a 360 px viewport with JavaScript disabled. Mobile layout had no horizontal overflow. Owner sign-in opened the account dashboard and remained valid after reload.
- Blog draft autosave was checked in the browser: the background PATCH returned 200 and the text persisted after reload. The temporary draft was deleted.
- School administrators must not moderate unrelated city/event rooms merely because their role differs from USER. A regression test now covers that boundary.
- The new search suite is included in the root test command. Its index checks distinguish GIN eligibility from the planner's choice of another valid index.

## Epics

| Epic | Implemented in the working tree | Remaining acceptance |
| --- | --- | --- |
| E1 Foundation | Monorepo, Compose, CI, PostGIS migrations, three languages, structured logs, error reporting, worker/operations hooks | Railway provisioning, domain/TLS, real backup restore and external alerts |
| E2 Accounts | Password/magic/optional Google sign-in, onboarding, skills, public profiles, export/deletion, claims, account dashboard; incoming email-change/Google-link settings | Production mail/OAuth and device/session acceptance |
| E3 Catalogue | Hierarchical styles, cities, autocomplete, directories/follows, localized city names and PostgreSQL search | Editorial review of launch-city content |
| E4 Events | CRUD, recurrence, teams/artists, RSVP, occurrence cancellation; incoming per-date RSVP and moved dates | Organizer/browser acceptance and real notification delivery |
| E5 Geography | Cached geocoder, venues, MapLibre clusters, PostGIS radius search | Production geocoder/tiles and mobile rendering benchmark |
| E6 Calendar | Month/week/list, filters, time zones, ICS and subscription feeds | Real external-calendar subscription refresh |
| E7 Media | Validated uploads, image variants, Instagram caching/fallback; lightweight homepage assets | Real S3 and Meta integration |
| E8 Blog | TipTap, draft autosave/version conflict handling, photo controls, school authorship, persistent embeds, full-text RSS, SEO | Broader editor/photo accessibility checks; reliable queued follower delivery |
| E9 Administration | Refine CRUD/moderation/claims/audit, owner/global/school roles and school console | Target-environment deployment and school-operator acceptance |
| E10 PWA | Manifest, service worker/offline agenda, push subscriptions, reminders and notification center | Physical iOS/Android install/push checks |
| E11 Matching | Opt-in skills, eligibility/ranking, mutual interest and blocks/reports | User/abuse acceptance |
| E12 Chat | Database/Redis chat, direct/groups/event/city rooms, SSE, school access; incoming attachments and message updates | Integration/device testing; Matrix is not deployed |
| E13 Courses | Weekly classes, school schedules, subscriptions and digest worker | Real email delivery and unsubscribe acceptance |
| E14 Imports | RSS/iCal/Schema.org, deduplication/moderation, Telegram handlers | Approved live-source and bot delivery checks |

## Roles and school scope

OWNER is the platform owner. ADMIN is a global administrator. SCHOOL_ADMIN accesses only schools assigned through SchoolAdmin (school claims also establish management in the site). MODERATOR remains a separate global moderation role.

Only an owner can promote another account to global administrator. HTTP role changes cannot create, demote or ban an owner. Global administrators assign/revoke school administrators through /schools. School administrators cannot use global CRUD, role-management or moderation APIs.

School resources include classes, posts, venues and group conversations. Ownership is checked again on the server for reads and writes; changing an ID in the URL does not grant access to another school. Site permissions allow managers to act for their schools' events/posts/chats.

Tests: apps/admin/tests/school-rbac.test.ts, apps/web/tests/schools.test.ts and apps/web/tests/chat.test.ts. Local owner credentials are intentionally absent from documentation and source control.

## Architecture and deployment

The application uses REST routes, PostgreSQL full-text/trigram search and chat in the monolith with Redis delivery. The original specification proposed tRPC, Meilisearch and Matrix; compare the current requirement amendments before marking architecture acceptance complete.

Local media uses .data/media; production can use S3. The historical MinIO image download failed, so production object storage still needs a working deployment. See [Railway configuration](deployment.md) and the [worker runbook](worker.md).

## Local commands

```sh
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
# Separate terminal:
pnpm worker
```

Web runs on port 3000; admin runs on 3001. Stop running app processes before Prisma regeneration on Windows.

## Optional integration settings

| Purpose | Variables |
| --- | --- |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET |
| Web Push | VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT |
| Storage | S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_URL |
| Instagram | INSTAGRAM_OEMBED_TOKEN when required by the configured provider |
| Geocoding | GEOCODER_URL, GEOCODER_USER_AGENT, PHOTON_URL |
| Telegram | TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME |
| HTTP cron | CRON_SECRET |
| Error reporting | SENTRY_DSN |
| Admin/web URLs | ADMIN_URL, WEB_URL |

/api/health/worker reports 503 when a valid fresh heartbeat is unavailable. /api/health is process liveness; the readiness route checks service dependencies.

Before public release, verify hosting/HTTPS, backup retention and restore, privacy policy, accessibility and physical-device PWA/push behavior.

## Blog delivery limitation

Draft autosave does not silently edit published posts. Follower notifications still run in the web process; a crash can interrupt delivery. Moving the work to a durable outbox/worker with idempotent recipient delivery remains open.
