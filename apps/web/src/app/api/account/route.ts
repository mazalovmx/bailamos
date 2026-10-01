import {db} from '@dance/db';
import {auth} from '../../../lib/auth';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {deleteAccountSchema} from '../../../lib/validation';
import {deleteAccount} from '../../../lib/account/delete';
const FRESH_MS = 10 * 60 * 1000;
// Deletes the caller's account. Password accounts must give the password; accounts without one (Google, magic link)
// must have signed in within the last 10 minutes and type their email address.
export async function DELETE(request: Request) {
  try {
    const user = await actor(request);
    const input = deleteAccountSchema.parse(await jsonBody(request));
    const credential = await db.account.findFirst({where: {userId: user.id, providerId: 'credential'}, select: {password: true}});
    if (credential?.password) {
      if (!input.password) throw new ApiError('PASSWORD_REQUIRED', 400);
      const context = await auth.$context;
      if (!await context.password.verify({hash: credential.password, password: input.password})) throw new ApiError('INVALID_PASSWORD', 403);
    } else {
      const session = await auth.api.getSession({headers: request.headers});
      if (!session || Date.now() - new Date(session.session.createdAt).getTime() > FRESH_MS) throw new ApiError('FRESH_LOGIN_REQUIRED', 403);
      if (input.confirmEmail?.toLowerCase() !== user.email.toLowerCase()) throw new ApiError('CONFIRMATION_MISMATCH', 400);
    }
    const result = await deleteAccount(user.id);
    console.info(JSON.stringify({level: 'info', event: 'account_deleted', mediaRemoved: result.mediaRemoved}));
    const headers = new Headers({'Content-Type': 'application/json'});
    for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token'])
      headers.append('Set-Cookie', name + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' + (name.startsWith('__Secure-') ? '; Secure' : ''));
    return new Response(JSON.stringify({deleted: true}), {headers});
  } catch (error) {return apiError(error);}
}
