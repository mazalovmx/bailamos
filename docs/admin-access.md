# Admin access

The production panel uses `https://admin.bailamos.me`. It is a separate Railway service (`bailamos-admin`) from the same repository and `deploy` branch, with the build/start commands from `railway.admin.json`. Give it the same production database and auth secret as web, `ADMIN_URL=https://admin.bailamos.me`, `WEB_URL=https://bailamos.me`, and a complete Google credential pair (`CLIENT_ID_GOOGLE`/`CLIENT_SECRET_GOOGLE` or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). Set `ADMIN_URL` on web too so staff see the panel link.

Add `https://admin.bailamos.me/api/auth/callback/google` to the existing Google OAuth client's authorized redirect URIs. The web callback remains `https://bailamos.me/api/auth/callback/google`.

Set `RAILPACK_BUILD_CMD=pnpm db:generate && pnpm --filter @dance/admin build` on the admin service. This explicitly selects the admin build in Railpack; otherwise the monorepo's `build:railway` script can select the web app even when the service build command is set. Apply the matching build/start/health settings directly to the new service: Railway no longer allows new services to opt into `railway.admin.json` as Config as Code.

Sign in with Google on the panel's login page. Ordinary users register on the main site; public admin sign-in never creates users, even when a social sign-in request explicitly asks to sign up. A verified, unbanned user can receive an admin session if they have a platform staff role or actual school access. The session cookie has its own `dance-admin` prefix. Roles, school memberships and bans are read from the database on every protected request.

Owners can add access at **Users → Add user** (`/r/users`). Enter the exact Google email and explicitly choose **Whole platform** or **Specific school**. Platform choices are global administrator (`ADMIN`) or global moderator (`MODERATOR`). School choices are administrator (resources only) or manager (resources and team), scoped to the selected school. New accounts have no password, verified email or session. Share the returned login link; Google must return the same freshly verified email before linking the account. Repeated grants are safe and changes are audited.

Platform ownership (`OWNER`) is the highest role. Only owners grant global administrators; global administrators can manage all schools and assign moderators. Global moderators review platform content and can also have explicit school memberships, without gaining access to every school. School membership never overwrites a platform role.

Creating a school on the site, during school onboarding, or in the admin panel automatically grants the creator `SchoolAdmin.canManageAdmins=true`. An approved school ownership claim grants the same permission. A school manager can add or remove team members by email from **My schools** on the site or **Schools → School administrators** in the admin panel, including people who have never registered. A school administrator can manage the school's events, posts, venues and conversations, but cannot manage its team or any other school's resources. One account can be a manager of one school and an administrator of another. Self-removal and removal of the last school manager are protected.

School rights are stored in `SchoolAdmin(userId, schoolProfileId, canManageAdmins)` independently of `User.role`. New school members retain `USER`; existing global roles are preserved. The old `SCHOOL_ADMIN` enum alone grants no panel access without an actual membership or owned school profile. There is no new database migration for this release. Creating a school does not end the current web session: the panel link and permissions appear on the next request. Revoking one school leaves other school access intact; revoking the final scope prevents further panel requests and Google admin sign-in, even with an existing cookie. Use the platform role action to remove global rights and the school's team action to remove school rights. Banning a user blocks both.

Event ownership/co-organizer memberships and conversation administrator memberships remain scoped to their respective event or conversation; these do not automatically grant global platform rights.

This flow does not send email. Production SMTP is not configured; use **Copy login link** to share the address. It requires no mail service or worker.

Bootstrap an existing owner account with:

```sh
railway ssh --service bailamos pnpm --filter @dance/db exec tsx prisma/grant-role.ts OWNER_EMAIL OWNER
```

This command records the role change in the audit log; it does not create an account or verify an email. The production owner account is `mazalovalexandr@gmail.com` (explicitly selected by the project owner). Do not grant ownership based on an email suffix or automatically grant it at registration.

Email/password access can be disabled with `EMAIL_AUTH_ENABLED=false`; Google then remains the panel's sign-in method. The panel has no password recovery or registration flow. Access problems caused by missing staff roles or a rejected OAuth callback return to login with a staff-access error.

The admin Railway service uses one replica, sleeps when idle, and has a 0.5 GB RAM / 0.25 CPU ceiling. The existing workspace spending cap is unchanged.
