import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {claimSchema} from '../../../lib/validation';
import {canClaimProfile} from '../../../lib/account/permissions';
// Asks to take over an ownerless stub profile. The request stays PENDING until a moderator decides it in the admin panel.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const input = claimSchema.parse(await jsonBody(request));
    const profile = await db.profile.findFirst({where: {handle: input.handle, hiddenAt: null}, select: {id: true, userId: true}});
    if (!profile) throw new ApiError('NOT_FOUND', 404);
    if (!canClaimProfile(user.id, profile)) throw new ApiError('CLAIM_NOT_AVAILABLE', 409);
    // One account owns at most one profile, so an approved claim could not be attached to someone who already has one.
    if (user.profile) throw new ApiError('CLAIM_HAS_PROFILE', 409);
    if (await db.profileClaim.findUnique({where: {profileId_userId: {profileId: profile.id, userId: user.id}}, select: {id: true}}))
      throw new ApiError('CLAIM_EXISTS', 409);
    if (await db.profileClaim.count({where: {userId: user.id, status: 'PENDING'}}) >= 3) throw new ApiError('CLAIM_LIMIT', 429);
    const claim = await db.profileClaim.create({data: {profileId: profile.id, userId: user.id, message: input.message}, select: {id: true, status: true}});
    return Response.json(claim, {status: 201});
  } catch (error) {return apiError(error);}
}
