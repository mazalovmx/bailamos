# Delivery status — October 1, 2026

Branch: `feature/requirements-gaps`. This page describes the current working tree. Local checks do not imply that Railway or external providers have been configured. See [the detailed audit](implementation.md).

## Current acceptance checks

Current verification: root `pnpm test` passed all 241 checks (230 web, 8 admin, 3 translation), with no failures or skips. Root lint and separate web/admin package typechecks passed. The root `pnpm typecheck` wrapper hit Windows `EPERM` when Prisma tried to replace its query-engine DLL; the two app typechecks pass independently. Prisma reports all 11 migrations applied. The live synthetic DeepSeek smoke test passed using `deepseek-chat` (JSON schema, title, date/time, recurrence and style checks; 1.3 seconds). The event pin was visually checked on desktop and at 390/360 px; clicking the map updates the marker and coordinates, there is no horizontal overflow, and the browser reported no page errors. The first-visit guides have not yet been visually checked: Next dev/build cannot load its SWC native binding because the cache directory has an untrusted Windows owner ACL; an earlier build passed before the current outbox change.

- The homepage explains event discovery, dance profiles and community publishing. At 360 px both primary calls to action are visible on the first screen.
- City/style search fields are full-width text inputs rather than checkbox-sized boxes. Browser checks entered Madrid and Lindy, selected two cities and two styles, and preserved the selections when switching to Russian.
- All eight homepage photographs loaded as distinct static responsive assets on desktop and mobile; the Solo Jazz and Workshops cards use different images.
- Owner sign-in works in the administrative panel, including access to school administration.
- The account dashboard is available at /en/account. Ordinary sign-in now defaults to it while preserving explicitly requested return paths.
- All ten public navigation links were clicked successfully on a 360 px viewport with JavaScript disabled. Mobile layout had no horizontal overflow. Owner sign-in opened the account dashboard and remained valid after reload.
- Blog draft autosave was checked in the browser: the background PATCH returned 200 and the text persisted after reload. The temporary draft was deleted.
- School administrators must not moderate unrelated city/event rooms merely because their role differs from USER. A regression test now covers that boundary.
- The new search suite is included in the root test command. Its index checks distinguish GIN eligibility from the planner's choice of another valid index.
- The event location selector supports a venue or an exact map pin. The map works by click and drag; keyboard-accessible coordinate fields remain available when map tiles fail.

## Epics

| Epic | Implemented in the working tree | Remaining acceptance |
| --- | --- | --- |
| E1 Foundation | Monorepo, Compose, CI, PostGIS migrations, three languages, structured logs, error reporting, worker/operations hooks; Railway web/worker/admin configuration | Railway provisioning, domain/TLS, real backup restore and external alerts |
| E2 Accounts | Password/magic/optional Google sign-in, onboarding, skills, public profiles, export/deletion, claims, account dashboard, email-change/Google-link settings, partner-search consent log; contextual first-visit guides for account, events, school setup/administration and Instagram/WhatsApp image sharing (EN/ES/RU), with per-section replay | Browser acceptance of guide behavior and production mail/OAuth/device/session acceptance |
| E3 Catalogue | Hierarchical styles, cities, autocomplete, directories/follows, localized city names across event, school, class, profile, venue, digest and Telegram views; PostgreSQL search | Editorial review of launch-city content |
| E4 Events | CRUD, recurrence, teams/artists, RSVP, per-date RSVPs and moved dates, venue or exact interactive map pin | Organizer/browser acceptance across time zones and real notification delivery |
| E5 Geography | Cached geocoder, venues, MapLibre clusters, PostGIS radius search | Production geocoder/tiles and mobile rendering benchmark |
| E6 Calendar | Month/week/list, filters, time zones, ICS and subscription feeds | Real external-calendar subscription refresh |
| E7 Media | Validated uploads, image variants, Instagram caching/fallback; lightweight homepage assets | Real S3 and Meta integration |
| E8 Blog | TipTap, draft autosave/version conflict handling, photo controls, school authorship, persistent embeds, full-text RSS, SEO; first-publication follower notices use a transactional outbox and worker | Broader editor/photo accessibility checks; production worker delivery and retry acceptance |
| E9 Administration | Refine CRUD/moderation/claims/audit, owner/global/school roles and school console | Target-environment deployment and school-operator acceptance |
| E10 PWA | Manifest, service worker/offline agenda, push subscriptions, reminders and notification center | Physical iOS/Android install/push checks |
| E11 Matching | Opt-in skills, eligibility/ranking, mutual interest and blocks/reports | User/abuse acceptance |
| E12 Chat | Database/Redis chat, direct/groups/event/city rooms, SSE, school access; image attachments, message updates and per-conversation notification mute | Integration/device testing; Matrix is not deployed |
| E13 Courses | Weekly classes, school schedules, subscriptions and digest worker | Real email delivery and unsubscribe acceptance |
| E14 Imports | RSS/iCal/Schema.org, deduplication/moderation, Telegram handlers | Approved live-source and bot delivery checks |
| E15 Event parser | Optional DeepSeek JSON extraction, strict validation, timezone-aware date normalization, geocoding, cached results, human confirmation and edit-rate telemetry; live synthetic DeepSeek smoke test passed (`deepseek-chat`, JSON/schema/date/style/recurrence checks) | Configure production credentials and measure accuracy/edit rate on the labelled 50-announcement sample |

## Roles and school scope

OWNER is the platform owner. ADMIN is a global administrator. SCHOOL_ADMIN accesses only schools assigned through SchoolAdmin (school claims also establish management in the site). MODERATOR remains a separate global moderation role.

Only an owner can promote another account to global administrator. HTTP role changes cannot create, demote or ban an owner. Global administrators assign/revoke school administrators through /schools. School administrators cannot use global CRUD, role-management or moderation APIs.

School resources include classes, posts, venues and group conversations. Ownership is checked again on the server for reads and writes; changing an ID in the URL does not grant access to another school. Site permissions allow managers to act for their schools' events/posts/chats.

Tests: apps/admin/tests/school-rbac.test.ts, apps/web/tests/schools.test.ts and apps/web/tests/chat.test.ts. Local owner credentials are intentionally absent from documentation and source control.

First-visit help uses Driver.js 1.8.0 (MIT), installed in the web and admin apps. Each small tour is keyed to the signed-in user and section in local storage, can be replayed from a floating help button, and is translated into English, Spanish and Russian. User flows are split across account, event creation, school directory, school administration and announcement sharing.

## Architecture and deployment

The application uses REST routes, PostgreSQL full-text/trigram search and chat in the monolith with Redis delivery. The owner accepted PostgreSQL search and the custom chat transport as architecture decisions; the Matrix proposal is recorded as a deviation in the requirements.

Local media uses .data/media; production can use S3. The historical MinIO image download failed, so production object storage still needs a working deployment. See [Railway configuration](deployment.md) and the [worker runbook](worker.md). Railway configuration files do not create services, domains, secrets, storage or environments; those remain platform setup tasks.

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
| Event parser | DEEPSEEK_API_KEY, optional DEEPSEEK_MODEL and DEEPSEEK_API_URL |
| HTTP cron | CRON_SECRET |
| Error reporting | SENTRY_DSN |
| Admin/web URLs | ADMIN_URL, WEB_URL |

/api/health/worker reports 503 when a valid fresh heartbeat is unavailable. /api/health is process liveness; the readiness route checks service dependencies.

Before public release, verify hosting/HTTPS, backup retention and restore, privacy policy, accessibility and physical-device PWA/push behavior.

## Production and user acceptance still outstanding

- Provision Railway web, admin and worker services, domains, TLS, staging and production variables. The repository contains service configuration only.
- Run a real `pg_dump` backup and restore; the local backup job has only exercised the missing-client fallback. Deploy GlitchTip or another Sentry-compatible receiver and external worker alerts.
- Decide whether to provision self-hosted Nominatim/Photon, and connect Postal/Listmonk if required. Current geocoding uses the public service with caching and rate limits; email uses SMTP.
- Configure production SMTP, OAuth, DeepSeek, S3, VAPID, Meta and Telegram credentials; verify each against its real provider and approved event sources. The local DeepSeek API call passed with a synthetic announcement; the smoke command is `pnpm --filter @dance/web smoke:deepseek`.
- Test PWA installation and push on iOS/Android, calendar feed refresh in Google/Apple Calendar, and event workflows with organizers.
- Configure the DeepSeek key in each deployed environment and measure the parser against the specified labelled sample of 50 real announcements. A passing synthetic API call verifies connectivity and schema handling, not real-world extraction accuracy.
- Complete visual/accessibility acceptance of the new section guides on mobile and desktop; first-visit persistence, manual replay, keyboard navigation and EN/ES/RU copy currently pass static checks only.
- Measure event-page LCP, 1,000-marker mobile map rendering, 10,000-MAU/50,000-event capacity and 99.5% availability; run the WCAG 2.1 AA audit for key workflows. The local 50,000-row radius query benchmark does not establish these other targets.

## Blog delivery notes

Draft autosave does not silently edit published posts. Follower notifications are stored with the first publication and drained by the worker; in-app delivery is idempotent across retries. Push delivery still depends on the configured provider and should be verified in production.
