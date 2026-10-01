# GitHub and Railway

Repository: https://github.com/mazalovmx/bailamos

## Branches

- experiments — development and experiments.
- stable — reviewed baseline and default GitHub branch.
- deploy — release source for Railway.

Promote through PRs: experiments → stable → deploy. Feature branches go into experiments first. CI runs on these branches and pull requests and supports manual dispatch. The stable name does not imply completion of every MVP requirement.

## Preserve configuration when merging

railway.json, railway.worker.json, start/release scripts, CI, pnpm-lock.yaml, migrations, seed data and photographs belong in all three branches. Change configuration alongside application code and promote ordinary merges. Do not copy only selected files over a branch or force-push a release. Resolve configuration conflicts explicitly: choosing an entire side can discard changes.

Secrets live in Railway Variables, outside Git. Repository/branch selection, domains, persistent volumes and Wait for CI are service settings. A code merge should not recreate the service. .env.example contains local examples only.

Never edit/delete applied migrations. Add new migrations. Release uses prisma migrate deploy, not reset or db push. Seed adds missing reference data without deleting user records. Back up production and check compatibility before schema changes; reverting code does not reverse migrations.

## Connect the web service

The root railway.json defines build/start settings but does not connect GitHub or select a branch. Choose mazalovmx/bailamos, branch deploy, root directory /, and enable Wait for CI. Do not connect other branches to the production web service.

- Build: pnpm build:railway (Prisma generation and web build).
- Pre-deploy: pnpm release:railway (migrations, then idempotent catalogue seeding).
- Start: pnpm start, binding 0.0.0.0 and Railway's PORT.
- Health: /api/health tests process liveness; pre-deploy checks schema application separately.

## Required configuration

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | Dedicated PostgreSQL with **PostGIS**. Plain PostgreSQL without the extension cannot run these migrations. Use a persistent volume and backups. |
| BETTER_AUTH_URL | Full public HTTPS URL. |
| BETTER_AUTH_SECRET | Unique production secret, at least 32 characters. |
| SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM | Real verification, recovery and notification email delivery. Mailpit is development-only. |
| RAILPACK_PRUNE_DEPS=false | Retain prisma, tsx and dotenv-cli for release commands. |
| NEXT_TELEMETRY_DISABLED=1 | Optional telemetry setting. |

Railway supplies PORT. .env is local and ignored. The root config deploys web only, not admin or the background worker. Create a separate worker service with railway.worker.json following the [worker runbook](worker.md). Expanded modules require Redis, worker scheduling, persistent media storage and integration-specific configuration. Do not assume they are operational until exercised in the target environment.

Sources: [Railway configuration](https://docs.railway.com/config-as-code/reference), [GitHub autodeploys/Wait for CI](https://docs.railway.com/deployments/github-autodeploys), [Railpack Node.js settings](https://railpack.com/languages/node/).
