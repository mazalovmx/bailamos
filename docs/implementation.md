# Implementation status

Audited on 2026-10-01 on `feature/requirements-gaps`. This is the current working tree, not a statement that the feature branch has been promoted to `stable` or deployed.

## Verified baseline and current changes

Current verification: see [current delivery status](status.md). The latest root test run passed 241 checks; lint and the web typecheck passed, and an interactive event pin was checked in the browser. Counts and checks in the detailed historical audit below describe an earlier baseline.

The homepage has the supplied photographs, visible EN/ES/RU selection (English by default), mobile layouts, swing-focused class discovery and multi-select filters. The announcement studio exports PNG images for Instagram posts/stories and WhatsApp, with native file sharing where the browser supports it.

The feature branch now contains implementations across all fifteen epics. The table distinguishes implemented work from acceptance still required.

| Epic | Implemented in the working tree | Remaining acceptance / dependencies |
| --- | --- | --- |
| E1 Foundation | pnpm monorepo; PostgreSQL/PostGIS migrations; Redis; CI; translations; Railway web, worker and admin configs; structured worker logs and heartbeat | Provision Railway services, HTTPS, durable storage, error monitoring and external worker alerts; run a real backup and demonstrate restoration. |
| E2 Accounts and profiles | Email/password, verification/reset, magic links, optional Google OAuth; onboarding; multiple skills; privacy settings; public profiles; account export/deletion; object permissions; contextual first-visit guides for account, event creation, school setup/administration and social image sharing in EN/ES/RU, with replay | Browser acceptance of first-visit/replay/mobile guide behavior; exercise Google OAuth with configured credentials and real production email delivery. |
| E3 Catalogue | 97 cities and 291 hierarchical styles; ID-based lookup, directories and follows; descendant-aware event search; admin resources | Curate actual launch-city venues and content; validate editorial taxonomy with organizers. |
| E4 Events | Draft/public/cancel lifecycle, materialized recurring dates, per-date RSVP and moves, venue or interactive map pin, invitations, artists, participant privacy, RSVP, calendar export, short links and OG images | Complete organizer/user acceptance across time zones and real cancellation notifications. |
| E5 Geography | Venue coordinates, cached geocoding, MapLibre/clustering, indexed PostGIS radius search, coarse profile locations | Configure production tiles/geocoder and verify the 1,000-marker mobile rendering target; IP-city behavior needs product acceptance. |
| E6 Calendar | Month/week/list, event-local or viewer time, filters, single/series ICS and public calendar feeds, timezone definitions and HTTP validators | Verify subscription refresh in real Google/Apple calendar clients. |
| E7 Media | Local/S3 upload adapters, image validation/conversion, Instagram URL validation, cached embeds and fallback cards | Provision persistent production storage and test signed uploads; verify configured Meta integration. A working fallback does not prove live oEmbed access. |
| E8 Blog | TipTap editor, drafts/public posts, images/embeds, event-linked reports, feeds, RSS, SEO metadata and reporting; durable first-publication follower-notification outbox | Browser acceptance for rich-text editing, accessibility and real media; production worker delivery. |
| E9 Administration | Refine resources, role checks, moderation/ban/claim actions, audit records and three interface languages | Deploy protected admin service and exercise moderator workflows in its UI. |
| E10 PWA and notifications | Manifest/icons, service worker/offline views, notification center/preferences, push subscriptions, reminder jobs and transactional email | Real-device iOS/Android installation/offline checks and push delivery with VAPID; verify reminder delivery two hours before an event. |
| E11 Partner matching | Explicit skill opt-in, compatible roles, level/radius filters, interests and blocks | User acceptance, moderation operations and abuse/load checks. |
| E12 Chat | Owner-approved custom database-backed chat, Redis SSE delivery/polling fallback, school/event/city/group conversations, image attachments, edits/deletes, mute and access/moderation checks | Browser/device and organizer acceptance; Matrix/Element was intentionally replaced. |
| E13 Courses and digest | Class/school schedules, subscriptions, weekly digest and background scheduling | Production email/unsubscribe delivery and organizer acceptance of the schedule UI. |
| E14 Imports and Telegram | RSS/iCal/Schema.org parsers, source jobs/retries, deduplication/moderation, Telegram handlers | Configure approved live sources and bot credentials; verify webhook/search/notification delivery and ambiguous-import moderation. |
| E15 Event parser | Optional DeepSeek extraction from pasted announcements, validation, normalization, map location suggestions, human confirmation and edit-rate logging | Configure provider credentials and measure against the labelled sample of 50 real announcements. |

## Audit evidence

Local services: PostgreSQL 17/PostGIS 3.5, Redis 7.2 and Mailpit. Checks use local test records; passing them does not prove external integrations or production availability.

- ESLint and TypeScript checks passed.
- Both production builds (web and admin) passed on an earlier revision. The current tree's web build/dev startup is blocked before app compilation by the Windows SWC cache ACL described in [delivery status](status.md).
- Historical baseline root test run passed 174 tests: 164 web feature tests, 7 admin tests and 3 translation tests. The current run of 241 checks is recorded in [delivery status](status.md).
- The HTTP workflow passed registration, email verification, profiles, draft privacy, permissions, publication, RSVP, a recurring event with co-organizers/artists and password reset.
- Database integration checks passed for PostGIS synchronization, radius queries, default draft status and coordinate constraints; temporary fixtures were rolled back.
- Browser checks passed on 360 px mobile and 1440 px desktop without uncaught page errors or horizontal overflow. EN/ES/RU homepages, calendar, cities, styles, classes, feed and login returned successfully. Anonymous admin access redirected to sign-in.
- The mobile header now measures about 121 px, down from 293 px. Menu opening, Escape/focus return and close-on-navigation work. Two cities and two styles remained selected in the URL after switching to Spanish. All six homepage images loaded after scrolling; desktop navigation remains visible.
- The 50,000-event radius benchmark used `event_geo_idx`. Client round-trip p95 over 30 runs was 46.0 ms for 25 km/7 days, 36.6 ms for 25 km/30 days, and 42.0 ms with Swing descendants. One 7-day outlier reached 105.1 ms: this supports the p95 target, not an absolute latency guarantee. The benchmark rolled back all fixture rows.
- Worker command discovery (`pnpm worker --list`) succeeds.

Reproduce the benchmark:

```sh
pnpm --filter @dance/db exec dotenv -e ../../.env -- tsx prisma/bench-radius.ts
```

Detailed run logs are local ignored artifacts under `test-results/`.

## Gaps fixed during this audit

1. Root `pnpm test` now includes admin tests.
2. CI now starts Redis and provides `REDIS_URL`, so Redis-dependent worker tests run instead of skipping.
3. Worker health rejects missing, malformed, stale and implausibly future-dated heartbeats. A regression test covers these cases.
4. A separate `railway.worker.json`, root worker command and [worker runbook](worker.md) document scheduling, required services and readiness.
5. README and maintained documentation are in English; the source Russian requirements remain available for historical comparison.
6. Mobile navigation now collapses into an accessible, translated menu. The language selector stays visible; Escape closes the menu and returns focus to its button. This fixes the roughly 293 px header observed at 360 px before the change.

## Release acceptance still open

Continue with real-device checks, then provision and verify external integrations. Source code alone cannot close backups/restoration, production email, OAuth, S3, push, external calendars, Telegram or availability targets. The custom chat deviation has been accepted; its organizer/device acceptance remains open.

Keep migrations, configuration, catalogue data and assets in normal branch promotions: feature branch → experiments → stable → deploy. See [deployment](deployment.md). Never mark an epic complete solely because routes exist or a build succeeds.
