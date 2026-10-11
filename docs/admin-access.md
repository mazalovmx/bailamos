# Admin access

The production panel uses `https://admin.bailamos.me`. It is a separate Railway service (`bailamos-admin`) from the same repository and `deploy` branch, with the build/start commands from `railway.admin.json`. Give it the same production database and auth secret as web, `ADMIN_URL=https://admin.bailamos.me`, `WEB_URL=https://bailamos.me`, and a complete Google credential pair (`CLIENT_ID_GOOGLE`/`CLIENT_SECRET_GOOGLE` or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). Set `ADMIN_URL` on web too so staff see the panel link.

Add `https://admin.bailamos.me/api/auth/callback/google` to the existing Google OAuth client's authorized redirect URIs. The web callback remains `https://bailamos.me/api/auth/callback/google`.

Sign in with Google on the panel's login page. Registration happens on the main site; the panel never creates users, even when a social sign-in request explicitly asks to sign up. Only verified, unbanned `OWNER`, `ADMIN`, `MODERATOR`, and `SCHOOL_ADMIN` accounts can receive an admin session. The session cookie has its own `dance-admin` prefix. Roles are read from the database on every protected request, so demotion or a ban takes effect immediately.

Bootstrap an existing owner account with:

```sh
railway ssh --service bailamos pnpm --filter @dance/db exec tsx prisma/grant-role.ts OWNER_EMAIL OWNER
```

This command records the role change in the audit log; it does not create an account or verify an email. The production owner account is `mazalovalexandr@gmail.com` (explicitly selected by the project owner). Do not grant ownership based on an email suffix or automatically grant it at registration.

Email/password access can be disabled with `EMAIL_AUTH_ENABLED=false`; Google then remains the panel's sign-in method. The panel has no password recovery or registration flow. Access problems caused by missing staff roles or a rejected OAuth callback return to login with a staff-access error.

The admin Railway service uses one replica, sleeps when idle, and has a 0.5 GB RAM / 0.25 CPU ceiling. The existing workspace spending cap is unchanged.
