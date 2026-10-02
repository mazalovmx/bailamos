import {db} from '@dance/db';
import {actor, apiError, ApiError} from '../../../../lib/api';
// DELETE /api/account/google — disconnects Google sign-in. Allowed only while a password remains,
// so an account is never left with a sign-in method that depends on mail delivery alone.
// Connecting goes through Better Auth (`POST /api/auth/link-social`), which needs the Google round trip.
export async function DELETE(request: Request) {
  try {
    const user = await actor(request);
    const accounts = await db.account.findMany({where: {userId: user.id}, select: {id: true, providerId: true, password: true}});
    const google = accounts.filter(a => a.providerId === 'google');
    if (!google.length) throw new ApiError('GOOGLE_NOT_LINKED', 404);
    if (!accounts.some(a => a.providerId === 'credential' && !!a.password)) throw new ApiError('LAST_SIGN_IN_METHOD', 409);
    await db.account.deleteMany({where: {id: {in: google.map(a => a.id)}, userId: user.id}});
    console.info(JSON.stringify({level: 'info', event: 'google_unlinked'}));
    return Response.json({linked: false}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return apiError(error);}
}
