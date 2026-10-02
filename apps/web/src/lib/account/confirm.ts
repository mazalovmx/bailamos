import {db} from '@dance/db';
import {auth} from '../auth';
import {ApiError} from '../api';
export const FRESH_MS = 10 * 60 * 1000;
/**
 * Re-checks who is asking before a sensitive change (new email, deletion).
 * Password accounts must give the password; accounts without one (Google, magic link) must have signed in within the last 10 minutes.
 */
export async function confirmIdentity(request: Request, userId: string, password?: string | null) {
  const credential = await db.account.findFirst({where: {userId, providerId: 'credential'}, select: {password: true}});
  if (credential?.password) {
    if (!password) throw new ApiError('PASSWORD_REQUIRED', 400);
    const context = await auth.$context;
    if (!await context.password.verify({hash: credential.password, password})) throw new ApiError('INVALID_PASSWORD', 403);
    return 'password' as const;
  }
  const session = await auth.api.getSession({headers: request.headers});
  if (!session || Date.now() - new Date(session.session.createdAt).getTime() > FRESH_MS) throw new ApiError('FRESH_LOGIN_REQUIRED', 403);
  return 'session' as const;
}
