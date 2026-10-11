type Env = Record<string, string | undefined>;
export function adminGoogleCredentials(env: Env = process.env) {
  for (const [id, secret] of [['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], ['CLIENT_ID_GOOGLE', 'CLIENT_SECRET_GOOGLE']]) {
    const clientId = env[id]?.trim(), clientSecret = env[secret]?.trim();
    if (clientId && clientSecret) return {clientId, clientSecret};
  }
  return null;
}
type AdminRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'SCHOOL_ADMIN';
export function mayEnterAdmin<T extends {role: string; bannedAt: Date | null; emailVerified: boolean}>(user: T | null): user is T & {role: AdminRole} {
  return !!user && !user.bannedAt && user.emailVerified && ['OWNER', 'ADMIN', 'MODERATOR', 'SCHOOL_ADMIN'].includes(user.role);
}
