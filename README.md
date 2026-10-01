# Bailamos — Dance Community

A multilingual social dance platform focused on swing, Lindy Hop and solo jazz. English is the default language, with Spanish and Russian available through the visible language switch.

Repository: [mazalovmx/bailamos](https://github.com/mazalovmx/bailamos). See [implementation status](docs/implementation.md) for the epic audit. Source code, locally tested functionality and production acceptance are tracked separately.

## Requirements and local setup

Node.js 22.18+, pnpm 10.15.1 and Docker with Linux containers (Docker Desktop on Windows). Run from the repository root:

```sh
pnpm install --frozen-lockfile
node scripts/setup.mjs
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000/en, http://localhost:3000/es, http://localhost:3000/ru.
- Admin: http://localhost:3001. Access requires an authorized account and administrative role.
- Process health: http://localhost:3000/api/health (liveness, not a database check).
- PostgreSQL/PostGIS: localhost:54329; Redis: localhost:63799. Credentials live in local `.env`.
- Development email inbox: http://localhost:8025 (Mailpit). Local verification/recovery messages are intercepted rather than sent externally.
- `scripts/setup.mjs` generates local secrets and fills missing settings while preserving existing values.
- `pnpm infra:down` stops containers without deleting Docker volumes.

The root URL opens /en regardless of browser language. The language switch preserves the current section and query. Use localhost:3000, matching BETTER_AUTH_URL, to test authentication.

## Application areas

The original verified baseline includes accounts, email verification, profiles, event CRUD, recurring classes, RSVP, multi-select discovery, a photographic homepage and PNG announcement export.

The current feature branch adds onboarding, multiple dance skills, a larger catalogue, venues, maps, calendars/iCal feeds, media, blogs, moderation, notifications, partner matching, chat, courses and event imports. See the epic audit for integration checks and external dependencies; a route's presence does not make the production integration complete.

To exercise the basic workflow, register at /en/register, verify the email in Mailpit, complete a profile, create an event and publish it. Seed data populates reference catalogues, not a fictitious public programme.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @dance/db test:integration
pnpm build
# With web, PostgreSQL and Mailpit running:
pnpm --filter @dance/web test:e2e
```

Tests cover PostGIS, access control, time zones/DST, translations and feature modules, including the admin suite. The HTTP workflow creates temporary users/events and removes them afterward. GitHub Actions runs against isolated PostgreSQL, Redis and Mailpit.

On Windows, stop web/admin processes before regenerating Prisma or running pnpm build: the Prisma DLL may be locked. When the generated client is current, pnpm -r build builds both applications without regeneration.

## Structure and documentation

- `apps/web` — Next.js/React, next-intl, Better Auth, CASL, public UI/API and worker.
- `apps/admin` — Next.js/Refine administration.
- `packages/db` — Prisma, migrations, catalogues and database utilities.
- `compose.yaml` — local infrastructure.
- [Implementation and epic status](docs/implementation.md)
- [Requirements in English](docs/requirements.md)
- [Swing class model](docs/swing-model.md)
- [Cities, styles and catalogue APIs](docs/catalogue.md)
- [Photographs and announcement export](docs/community-photos.md)
- [Git branches and Railway](docs/deployment.md)
- [Background worker and readiness](docs/worker.md)

The original Russian requirements document is retained at the repository root as source material. Subsequent owner decisions override it: English by default, a swing/Lindy Hop focus, multi-select discovery filters and Railway releases from deploy.

## Media and infrastructure

The supplied images are installed on the homepage; originals remain in images/. Announcement photos are processed in the browser. The separate media module includes local/S3 adapters; persistent production storage must be configured and tested.

MinIO remains an optional Compose storage profile: its original registry downloads failed. Standard infra:up starts PostGIS, Redis and Mailpit. Select a maintained S3-compatible deployment before accepting the production media epic.

The promotion path is experiments → stable → deploy. Railway configuration is versioned, but services, PostGIS, SMTP, domains, backups and monitoring still require deployment setup. Additional integrations need their runtime credentials/services. The web Railway config does not automatically deploy admin or workers.

Ticket sales, payments, video hosting, federation and native app-store wrappers are outside this iteration.
