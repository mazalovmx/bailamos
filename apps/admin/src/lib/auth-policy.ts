type Env = Record<string, string | undefined>;
export function adminGoogleCredentials(env: Env = process.env) {
  for (const [id, secret] of [['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], ['CLIENT_ID_GOOGLE', 'CLIENT_SECRET_GOOGLE']]) {
    const clientId = env[id]?.trim(), clientSecret = env[secret]?.trim();
    if (clientId && clientSecret) return {clientId, clientSecret};
  }
  return null;
}
export function mayEnterAdmin<T extends {role: string; bannedAt: Date | null; emailVerified: boolean; hasSchoolAccess?: boolean}>(user: T | null): user is T {
  return !!user && !user.bannedAt && user.emailVerified && (['OWNER', 'ADMIN', 'MODERATOR'].includes(user.role) || user.hasSchoolAccess === true);
}

// Invited accounts may start with an unverified local email. Only a fresh verified Google identity
// with the same email may link to them; role and ban still come from our database.
export function mayUseAdminGoogle(user: {email: string; role: string; bannedAt: Date | null; hasSchoolAccess?: boolean} | null,
  identity: {email: string; emailVerified: boolean}) {
  return !!user && !user.bannedAt && (['OWNER', 'ADMIN', 'MODERATOR'].includes(user.role) || user.hasSchoolAccess === true)
    && identity.emailVerified && user.email.toLowerCase() === identity.email.toLowerCase();
}
