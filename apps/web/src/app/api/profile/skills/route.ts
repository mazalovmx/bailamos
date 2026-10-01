import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../../lib/api';
import {skillsSchema} from '../../../../lib/validation';
import {canEditProfile} from '../../../../lib/account/permissions';
// Replaces the caller's skill list. lookingFor is stored exactly as sent and defaults to false: it is never inferred.
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED', 403);
    if (!canEditProfile(user.id, user.profile)) throw new ApiError('FORBIDDEN', 403);
    const {skills} = skillsSchema.parse(await jsonBody(request));
    const profileId = user.profile.id, styleIds = [...new Set(skills.map(s => s.styleId))];
    if (await db.danceStyle.count({where: {id: {in: styleIds}}}) !== styleIds.length) throw new ApiError('INVALID_INPUT', 400);
    await db.$transaction([
      db.danceSkill.deleteMany({where: {profileId}}),
      db.danceSkill.createMany({data: skills.map(s => ({profileId, styleId: s.styleId, role: s.role, level: s.level, lookingFor: s.lookingFor === true}))})
    ]);
    return Response.json({skills: skills.length});
  } catch (error) {return apiError(error);}
}
