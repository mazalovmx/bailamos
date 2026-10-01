import {db} from '@dance/db';
import {route} from '../../../lib/guard';
export const GET = route('STAFF', async () => {
  const claims = await db.profileClaim.findMany({where: {status: 'PENDING'}, orderBy: {createdAt: 'asc'}, take: 200,
    select: {id: true, message: true, createdAt: true,
      profile: {select: {id: true, handle: true, name: true, type: true, userId: true, city: {select: {name: true}}}},
      user: {select: {id: true, name: true, email: true, bannedAt: true, createdAt: true, profile: {select: {id: true, handle: true}}}}}});
  // Tells the moderator up front why an approval would be refused.
  return Response.json({data: claims.map(claim => ({...claim,
    blocked: claim.user.bannedAt ? 'CLAIMANT_BANNED' : claim.profile.userId && claim.profile.userId !== claim.user.id ? 'PROFILE_ALREADY_OWNED'
      : claim.user.profile && claim.user.profile.id !== claim.profile.id ? 'CLAIMANT_HAS_PROFILE' : null})), total: claims.length});
});
