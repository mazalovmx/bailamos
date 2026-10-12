# Admin access

The production panel uses `https://admin.bailamos.me`. It is a separate Railway service (`bailamos-admin`) from the same repository and `deploy` branch, with the build/start commands from `railway.admin.json`. Give it the same production database and auth secret as web, `ADMIN_URL=https://admin.bailamos.me`, `WEB_URL=https://bailamos.me`, and a complete Google credential pair (`CLIENT_ID_GOOGLE`/`CLIENT_SECRET_GOOGLE` or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). Set `ADMIN_URL` on web too so staff see the panel link.

Add `https://admin.bailamos.me/api/auth/callback/google` to the existing Google OAuth client's authorized redirect URIs. The web callback remains `https://bailamos.me/api/auth/callback/google`.

Set `RAILPACK_BUILD_CMD=pnpm db:generate && pnpm --filter @dance/admin build` on the admin service. This explicitly selects the admin build in Railpack; otherwise the monorepo's `build:railway` script can select the web app even when the service build command is set. Apply the matching build/start/health settings directly to the new service: Railway no longer allows new services to opt into `railway.admin.json` as Config as Code.

Sign in with Google on the panel's login page. Ordinary users register on the main site; public admin sign-in never creates users, even when a social sign-in request explicitly asks to sign up. Owners may provision an administrator through the action below. Only verified, unbanned `OWNER`, `ADMIN`, `MODERATOR`, and `SCHOOL_ADMIN` accounts can receive an admin session. The session cookie has its own `dance-admin` prefix. Roles are read from the database on every protected request, so demotion or a ban takes effect immediately.

Owners can add an administrator at **Users → Add user** (`/r/users`). Enter the exact email of their Google account and share the login link shown after saving. Existing users receive the `ADMIN` role; for a new email the owner provisions an unverified account with no password or session. The recipient can then sign in directly at `https://admin.bailamos.me/login` without first registering on the main site. Google must return the same verified email before it can link to the provisioned account; the app never marks an email verified just because the owner entered it. Only owners can use this action, banned accounts and other owners are protected, repeated additions are safe, and account provisioning and role changes are audited. Revoke access using the existing role action on the user's row.

This flow does not send email. Production SMTP is not configured; use **Copy login link** to share the address. It requires no mail service or worker.

Bootstrap an existing owner account with:

```sh
railway ssh --service bailamos pnpm --filter @dance/db exec tsx prisma/grant-role.ts OWNER_EMAIL OWNER
```

This command records the role change in the audit log; it does not create an account or verify an email. The production owner account is `mazalovalexandr@gmail.com` (explicitly selected by the project owner). Do not grant ownership based on an email suffix or automatically grant it at registration.

Email/password access can be disabled with `EMAIL_AUTH_ENABLED=false`; Google then remains the panel's sign-in method. The panel has no password recovery or registration flow. Access problems caused by missing staff roles or a rejected OAuth callback return to login with a staff-access error.

The admin Railway service uses one replica, sleeps when idle, and has a 0.5 GB RAM / 0.25 CPU ceiling. The existing workspace spending cap is unchanged.
