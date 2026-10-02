# Technical requirements: dance community platform

English working edition of the specification by Aleksandr Mazalov, dated September 22, 2026. The original Russian document is retained at the repository root. This edition preserves the functional scope, epic breakdown and acceptance requirements while separating historical technology assumptions from verified implementation. See [implementation status](implementation.md) for delivery evidence.

## Decisions made after the original specification

- English is the default language; English, Spanish and Russian are available from a visible selector on the first page.
- The primary audience dances swing, Lindy Hop and solo jazz. Model substyles, regular classes, masterclasses, workshops, solo/partner formats, levels, intensity, tempo and tags separately.
- Discovery selectors support multiple selections, including cities and styles.
- Prioritize a usable mobile experience, photographic sections and image export for Instagram and WhatsApp.
- Show short, contextual first-visit guides for the account, event creation, school setup/administration and social-image sharing. Do not show every guide at sign-in; trigger each when its section is first opened, and let users replay it.
- Git promotion is experiments → stable → deploy. Railway deploys from deploy, replacing the original Coolify/Hetzner hosting proposal.

## Scope and principles

Build a social dance platform with events on a map and calendar, profiles, partner matching by skill level, personal blogs with photographs and Instagram links, direct/group chat and an aggregated news/events feed.

Build a new application. WeDance 3.0 is a reference for domain and UX decisions, not the codebase to fork. The source specification cited Vue 2/Nuxt 2 end of life and the absence of a license in WeDance v4 as its rationale; review current repositories and licenses before reusing code.

1. Reuse established open-source components for authentication, administration, chat, search, maps and queues. Custom work should focus on event roles, matching and aggregation.
2. Prefer self-hostable components without per-user licensing or vendor lock-in. The original policy permits MIT, Apache and BSD, and AGPL for independent services. Verify the actual license/version and deployment obligations before adoption.
3. Instagram content is embedded from public post links. Users should not need business/creator accounts or Meta OAuth. Always retain a link-card fallback. The original assertion of tokenless oEmbed availability is **unverified** and must not be treated as an integration guarantee.
4. Use one web/mobile codebase with PWA support. A Capacitor wrapper is a later option if app-store distribution is needed.

Ticket sales/payments, video hosting, ActivityPub federation and publishing back to Instagram are outside the first release.

## Feature catalogue

The source table contains twenty features (despite its introductory count of eighteen).

| ID | Capability | Origin | Phase |
| --- | --- | --- | --- |
| F1 | Create events, public pages, link/social sharing | Owner request | MVP |
| F2 | Event roles: organizer, co-organizer, participant, artist | Owner request | MVP |
| F3 | Event photographs and Instagram post embeds | Owner request | MVP |
| F4 | Clustered event map and radius search | Owner request | MVP |
| F5 | Partner search by style, level, leader/follower role and city | Owner request | v1 |
| F6 | Personal dance blog with photographs and Instagram embeds | Owner request | MVP |
| F7 | Direct messages and group chats | Owner request | v1 |
| F8 | Automatically aggregated news and external events | Owner request | v2 |
| F9 | Hierarchical catalogue of 170+ styles, filters and follows | WeDance reference | MVP |
| F10 | City-first navigation, city programme and follows | WeDance reference | MVP |
| F11 | Schools, studios, venues and artists, including claimable ownerless profiles | WeDance reference | v1 |
| F12 | Regular classes/courses with weekly schedule, level, price and venue | WeDance reference | v1 |
| F13 | RRULE recurring parties and practices | WeDance reference | MVP |
| F14 | Going/interested RSVP, participant list and counters | WeDance reference | MVP |
| F15 | Weekly city email digest | WeDance reference | v1 |
| F16 | Schema.org Event, iCal and RSS imports | WeDance reference | v2 |
| F17 | Telegram event search and notifications | WeDance reference | v2 |
| F18 | English, Spanish and Russian interface | WeDance reference | MVP |
| F19 | Reports, moderation queue and bans | Additional requirement | MVP |
| F20 | iCal export and Google Calendar link | WeDance reference | MVP |

## Architecture

### System context

Dancers discover events/partners, publish posts and join groups. Organizers manage events, co-organizers and attendance. Schools/venues maintain profiles and class schedules. Moderators process reports through a separate admin application.

External systems are Instagram embeds, map tiles, geocoding, SMTP and external event feeds. Apart from the required mail service, providers should be replaceable or optional. An unavailable import source or Instagram post must not make the application unavailable.

### Containers

Use a modular monolith with separate worker processes sharing the same domain/database code. Avoid introducing microservices solely for the initial scale.

| Container | Proposed technology | Responsibility |
| --- | --- | --- |
| Web/PWA | Next.js 15, React 19, TypeScript | SSR, UI, API, sessions, maps and calendars |
| Database | PostgreSQL 17 / PostGIS 3.5 | Domain data, indexed geography and initial text search |
| Search, optional initially | Meilisearch | Search and facets for events/profiles/partners |
| Cache/queues | Redis 7 | Cache and BullMQ queues |
| Workers | Node.js / BullMQ | Imports, email, embed refresh and image processing |
| Media | S3-compatible storage, originally MinIO | Original images, previews and avatars |
| Chat, original proposal | Matrix Synapse / Element | Direct/group rooms and moderation |
| Admin | Refine | Resource CRUD, moderation and catalogue management |

The original host proposal was a single Docker Compose/Coolify server. Railway is the subsequent owner decision. The owner accepted the custom database/Redis chat as the implementation, replacing Matrix/Element; track this as an intentional architecture deviation.

### Domain components

- Events: event lifecycle, materialized recurrence, RSVP and contextual roles.
- Profiles: dancers, organizers, schools, venues and claimable artist stubs.
- Matching: style/role/radius eligibility, then level and activity ranking.
- Blog: authored posts and owned media; external URLs go through Embeds.
- Embeds: the single Instagram integration boundary, URL validation, server cache and graceful fallback.
- Feed: followed cities/styles/profiles, events and imported news.
- Geo: geocoding and indexed radius queries, independent of map provider.
- Moderation: reports, content state, bans and audit trails.

Better Auth supplies sessions. CASL checks permissions on every protected API operation, using the user's relationship to the object rather than only a global role. Modules should expose service boundaries instead of coupling callers to another module's tables. The original API preference was tRPC; the current implementation uses REST routes.

### Supporting components

Prisma manages migrations and typed database access, with parameterized SQL for PostGIS. MapLibre and supercluster render maps; a configurable tile service and Nominatim/Photon provide geographic data. FullCalendar standard plugins cover month/week/list views. rrule.js, Luxon and ical-generator support recurrence, IANA time zones and ICS. TipTap provides the rich-text editor; sharp provides image conversions. next-intl manages ICU translations. BullMQ handles retries and schedules.

The original operations shortlist included Postal/Listmonk for mail, GlitchTip for errors and Grafana/Loki for observability. These are proposals, not proof of deployment. The source license table contains conflicting Synapse statements and historical product/pricing claims; verify selected versions rather than relying on that table as a license audit.

## Data model and geography

- User has an optional public Profile; ownerless profiles may later be claimed.
- Profile has a unique handle, name, biography, type, city and optional geographic location. Public locations must be coarse.
- Profile types include DANCER, ORGANIZER, SCHOOL, VENUE and ARTIST. The source prose referred to four main types while its enum also included ARTIST.
- DanceSkill is unique by profile/style/role. Roles are LEADER, FOLLOWER or BOTH. Levels are NEWCOMER, BEGINNER, INTERMEDIATE, ADVANCED and PRO. Partner-search opt-in is explicit and defaults off.
- Event has a unique slug, description, UTC start/end, IANA time zone, optional recurrence, venue/city/location, styles, publication state and optional source URL.
- Event membership distinguishes OWNER, COORGANIZER, ARTIST and ATTENDEE. RSVP distinguishes GOING, INTERESTED and DECLINED.
- Materialized EventOccurrence records support date-based discovery and exceptions to a series. Normalize event/style relations with foreign keys.
- Media belongs to an event or post and distinguishes uploads from Instagram links. Store storage keys/source URLs and cached embed metadata separately.
- Index city/time queries and geographic columns. Enable PostGIS by SQL migration and add GiST indexes.

For radius searches, filter with ST_DWithin before sorting by distance. Do not replace the indexed predicate with a full-table ST_Distance filter. Benchmark a representative 25 km query against 50,000 events and inspect its query plan.

## Instagram integration

Accept supported public post/reel URLs, not profile URLs. Fetch provider content server-side, validate/sanitize results and rate-limit requests. Cache for a proposed 24 hours in Redis with persisted fallback metadata. If a post is private/deleted or the provider fails, render a direct link card. Do not copy Instagram media into application storage. Direct user uploads remain an independent path.

Live provider access, credentials, permitted caching and current provider terms require verification. The original no-token assumption is not a release acceptance result.

## Administration

Use Refine rather than writing a complete admin framework. The source compared React Admin, AdminJS, Directus, Strapi, Filament and low-code tools; Refine was selected for customizable application administration without a second backend language or CMS-owned data model.

Required resources include users/profiles, events, posts, venues, styles/cities, reports, claims, import sources/conflicts and relevant chat moderation. Moderation actions require a reason and an audit record. Bans prevent publication and chat. Claim approval assigns a verified owner to a stub profile. Reuse dedicated operational consoles for metrics, errors, mail and object storage where appropriate.

## Non-functional acceptance

| Area | Requirement |
| --- | --- |
| Page performance | Event-page LCP ≤2.5 seconds on a defined 4G test profile |
| Map performance | Render 1,000 markers within one second on the agreed target device |
| Radius search | Target ≤100 ms with 50,000 events; document percentile, environment and query shape |
| Initial scale | 10,000 monthly active users and 50,000 events without requiring sharding |
| Availability | Target 99.5% monthly |
| Recovery | Nightly database backups, 30-day retention and quarterly restoration exercises |
| Mobile | iOS/Android PWA, usable at 360 px, offline agenda |
| Languages | EN/ES/RU, ICU messages, no hardcoded user-facing copy |
| Privacy | Coarse public location, server-side radius filtering, export/deletion, consent and retention rules |
| Security | Rate limits for authentication/chat/embeds, nonce CSP, MIME/size validation, nofollow/ugc links |
| Moderation | Report any UGC; target review within 24 hours; bans affect publishing and chat |
| Age | Self-confirmation of age 16+ |
| Accessibility | WCAG 2.1 AA for key workflows |
| Operations | Structured logs, error/slow-query visibility and worker-failure alerts |
| Matching | Explicit opt-in per skill; no automatic inclusion |

These are acceptance targets, not claims about the current deployment.

## Epic plan

Estimates are the original planning estimates in person-weeks, not commitments or evidence of completion.

| Epic | Phase | Estimate | Dependencies |
| --- | --- | --- | --- |
| E1 Foundation | MVP | 2 | — |
| E2 Accounts/profiles | MVP | 3 | E1 |
| E3 Catalogue | MVP | 1.5 | E1 |
| E4 Events | MVP | 4 | E2, E3 |
| E5 Geography | MVP | 2.5 | E3, E4 |
| E6 Calendar | MVP | 2 | E4 |
| E7 Media/embeds | MVP | 2.5 | E1 |
| E8 Blog | MVP | 3 | E2, E7 |
| E9 Administration | MVP | 2.5 | E2 |
| E10 PWA/notifications | MVP | 1.5 | E4 |
| E11 Matching | v1 | 3.5 | E2, E5 |
| E12 Chat | v1 | 3 | E2 |
| E13 Courses/digest | v1 | 3 | E4, E10 |
| E14 Imports/Telegram | v2 | 4 | E4, E9 |

The source estimated MVP at 24.5 person-weeks, or 11–13 calendar weeks for three people, excluding design/content/acceptance. Its individual MVP rows sum to 24.5. v1 adds 9.5 and v2 adds 4 person-weeks. The critical path is E1 → E2 → E4 → E5. Re-estimate after E1/E2 based on actual delivery.

### E1 — Foundation

Create web/admin/database workspaces, local PostgreSQL/PostGIS/Redis/storage, CI lint/types/tests/build, staging/production deployment, migrations/GiST, localization and monitoring. Acceptance: three languages over HTTPS, repeatable deployment and scheduled backups. The later Railway/branch decision supersedes the original host and main-branch assumptions.

### E2 — Accounts and profiles

Implement password, magic-link and Google sign-in; email verification/reset and rate limits; profile types, unique handles, avatar/cover; onboarding city/styles/roles/levels; multiple skills and explicit matching opt-in; API permissions; public /@handle pages with Person metadata; export/deletion. Show a short, replayable guide on first entry to relevant sections rather than one long tour at sign-in. Acceptance: users can register and publish skills while private fields and unauthorized mutations remain protected; first-time visitors can find task guidance in English, Spanish and Russian.

### E3 — Catalogue

Seed at least 170 hierarchical styles and cities with coordinates/time zones. Add venues with addresses/coordinates, autocomplete and admin editing. Acceptance: forms select stable catalogue IDs rather than uncontrolled city/style text.

### E4 — Events

Implement draft/edit/publish/cancel/delete, RRULE with preview of the next ten dates and materialized occurrences, co-organizer invitations by handle/email, artist links/stubs, RSVP and privacy-aware attendance, event details/map/local time/media, ICS/Google export, OG previews/short links and cancellation notifications. Organizers choose a saved venue or place an event pin by clicking or dragging on the map; keyboard movement and coordinate fields remain available, and edits preserve the selected location. Acceptance: a weekly event with a co-organizer, artist and RSVP displays correctly to a visitor in another time zone.

### E5 — Geography

Provide cached forward/reverse geocoding, venue addresses, branded MapLibre rendering with clusters/popovers, indexed radius/date/style filters, IP-derived city with manual override and coarse profile coordinates. Acceptance: users can filter this week's city map by style; 25 km queries meet the documented performance target.

### E6 — Calendar

Provide month/week/list views over materialized occurrences, city/style/level/type filters, correct time-zone/DST handling and city/style subscription feeds. Acceptance: an external calendar subscription receives event updates correctly.

### E7 — Media and embeds

Provide signed uploads, MIME/size validation, WebP/AVIF conversion and lazy loading. Validate Instagram URLs and proxy/cache embeds, persist fallback data, reject profile URLs and rate-limit. Acceptance: event/blog content remains usable when Meta is unavailable.

### E8 — Blog

Provide TipTap text/headings/lists/images/Instagram blocks, draft/public CRUD, author/follow feeds, event reports, BlogPosting/OG/sitemap metadata, author RSS and reporting. Notify eligible followers once on first publication through a durable, idempotent background outbox. Acceptance: a festival report with images and embeds appears in the author's feed/RSS and has indexable public content; retries do not duplicate follower notifications.

### E9 — Administration

Provide separate role-protected Refine UI, resource CRUD, report queues, reasoned moderation actions, publishing/chat bans, claim approval and audit logs. Acceptance: a moderator can process a report and ban the responsible account in three actions, with the outcome recorded.

### E10 — PWA and notifications

Provide installable manifest/icons, service worker, offline agenda/event views, push reminders/new-attendee/chat-reply notifications, preferences/notification center and transactional mail. Acceptance: install on iOS/Android and receive an event reminder two hours before it starts.

### E11 — Partner matching

Filter opt-in candidates by compatible role, style, level within one step and radius; rank by suitability/activity. Support interests, mutual notifications, blocking and reports. Acceptance includes opt-out exclusion, role compatibility and blocked-user exclusion.

### E12 — Chat

The original requirement proposed Matrix deployment and Better Auth SSO, event/city rooms, direct messaging, moderation and stranger-message limits through an SDK or Element. The product owner accepted the custom database/Redis implementation as a deviation. The shipped feature includes direct/group/event/city/school conversations, image attachments, message edits/deletes, per-conversation mute, moderation and stranger-message limits. Acceptance still requires organizer and device testing.

### E13 — Courses and digest

Provide weekly classes with level/price/venue, school schedules, city/style/profile follows and weekly digest delivery. Acceptance includes schedule discovery and correct subscription/unsubscribe behavior.

### E14 — Imports and Telegram

Import RSS, iCal and Schema.org events through retryable jobs. Deduplicate by title/time/location and send ambiguous matches to moderation. Add Telegram search and notifications. Acceptance requires real approved sources and bot delivery, not only parser fixtures.

### E15 — Event parser

The event creation page optionally accepts pasted WhatsApp/Instagram announcement text and uses DeepSeek JSON mode to suggest fields for the organizer to review. Validation, city-timezone date checks, style matching and address geocoding run on the server; the organizer must explicitly confirm before saving. The provider key is optional and secrets belong in environment variables. Acceptance still needs the specified labelled sample of 50 real announcements and measured field accuracy/edit rates.

## Risks and open decisions

- Provider changes: retain cached/fallback links and direct uploads.
- Public geocoder limits: cache requests and support a configurable/self-hosted service.
- Chat transport: Matrix/Element was replaced by the owner-approved in-app chat; revisit only if operating experience calls for it.
- Empty content: launch with a curated programme in one city.
- Matching abuse: require opt-in, blocking/reporting and contact rate limits.
- Geographic performance: retain GiST coverage and a representative 50,000-event benchmark.
- Schedule uncertainty: revise estimates after foundational work.

Select the initial launch city and open/invite-only registration policy. The default language is English, and the chat architecture deviation has been accepted.

## Reference trail

The original document references WeDance v3/v4, Vue/Nuxt end-of-life notices, Meta oEmbed guidance and PostGIS ST_DWithin documentation. Retain the original for its dated citations. Current source code and [the audit](implementation.md) govern implementation status; third-party behavior, pricing and license assertions require fresh verification when adopting or deploying those services.
