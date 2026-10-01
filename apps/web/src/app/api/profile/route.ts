import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {profileSchema} from '../../../lib/validation';
import {canEditProfile} from '../../../lib/account/permissions';
// Creates or updates the caller's own profile. The owner is always the session user: no profile id is accepted.
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    const {styleId, role, level, ...fields} = profileSchema.parse(await jsonBody(request));
    const existing = user.profile;
    if (existing && !canEditProfile(user.id, existing)) throw new ApiError('FORBIDDEN', 403);
    if (!existing && !(await db.user.findUnique({where: {id: user.id}, select: {ageConfirmed: true}}))?.ageConfirmed)
      throw new ApiError('AGE_CONFIRMATION_REQUIRED', 403);
    const legacySkill = styleId && role && level ? {styleId, role, level} : null;
    const [city, style, clash] = await Promise.all([
      db.city.findUnique({where: {id: fields.cityId}, select: {id: true}}),
      legacySkill ? db.danceStyle.findUnique({where: {id: legacySkill.styleId}, select: {id: true}}) : null,
      db.profile.findUnique({where: {handle: fields.handle}, select: {userId: true}})
    ]);
    if (!city || (legacySkill && !style)) throw new ApiError('INVALID_INPUT', 400);
    if (clash && clash.userId !== user.id) throw new ApiError('HANDLE_TAKEN', 409);
    const profile = await db.$transaction(async tx => {
      const profile = await tx.profile.upsert({where: {userId: user.id}, create: {...fields, userId: user.id}, update: fields});
      // Partner search stays off here: it is switched on only per skill, in the skills editor.
      if (legacySkill) await tx.danceSkill.upsert({
        where: {profileId_styleId_role: {profileId: profile.id, styleId: legacySkill.styleId, role: legacySkill.role}},
        create: {...legacySkill, profileId: profile.id, lookingFor: false}, update: {level: legacySkill.level}});
      return profile;
    });
    return Response.json({handle: profile.handle});
  } catch (error) {return apiError(error);}
}
