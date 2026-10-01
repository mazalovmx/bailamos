import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../../lib/api';
import {onboardingSchema} from '../../../../lib/validation';
import {freeHandle} from '../../../../lib/account/handle';
import {logRegistrationConsents} from '../../../../lib/account/consent';
// First sign-in: creates a dancer profile from city, styles, role and level. Runs once; later edits use /api/profile.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (user.profile) throw new ApiError('PROFILE_EXISTS', 409);
    const input = onboardingSchema.parse(await jsonBody(request));
    const account = await db.user.findUnique({where: {id: user.id}, select: {ageConfirmed: true}});
    // Accounts created through Google have not confirmed their age or accepted the policy yet.
    if (!account?.ageConfirmed && !input.consent) throw new ApiError('AGE_CONFIRMATION_REQUIRED', 403);
    const [city, styles] = await Promise.all([db.city.findUnique({where: {id: input.cityId}, select: {id: true}}),
      db.danceStyle.count({where: {id: {in: input.styleIds}}})]);
    if (!city || styles !== input.styleIds.length) throw new ApiError('INVALID_INPUT', 400);
    const name = user.name.trim().length >= 2 ? user.name.trim().slice(0, 80) : user.email.split('@')[0].slice(0, 80).padEnd(2, '-');
    const handle = await freeHandle(name, async value => !!await db.profile.findUnique({where: {handle: value}, select: {id: true}}));
    if (!account?.ageConfirmed) {
      await db.user.update({where: {id: user.id}, data: {ageConfirmed: true}});
      await logRegistrationConsents(user.id);
    }
    const profile = await db.profile.create({data: {userId: user.id, type: 'DANCER', handle, name, cityId: input.cityId,
      skills: {create: input.styleIds.map(styleId => ({styleId, role: input.role, level: input.level, lookingFor: false}))}}});
    return Response.json({handle: profile.handle}, {status: 201});
  } catch (error) {return apiError(error);}
}
