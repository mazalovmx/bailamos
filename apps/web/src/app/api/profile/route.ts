import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {profileSchema} from '../../../lib/validation';
export async function PUT(request: Request) {
  try {
    const user = await actor(request);
    const input = profileSchema.parse(await jsonBody(request));
    const {styleId, role, level, ...fields} = input;
    const [city, style] = await Promise.all([db.city.findUnique({where:{id: fields.cityId}}), db.danceStyle.findUnique({where:{id: styleId}})]);
    if (!city || !style) throw new ApiError('INVALID_INPUT',400);
    const profile = await db.$transaction(async tx => {
      const profile = await tx.profile.upsert({where:{userId:user.id},create:{...fields,userId:user.id},update:fields});
      // This first onboarding form supports one primary skill. Matching remains opt-in and disabled.
      await tx.danceSkill.deleteMany({where:{profileId:profile.id}});
      await tx.danceSkill.create({data:{profileId:profile.id,styleId,role,level,lookingFor:false}});
      return profile;
    });
    return Response.json({handle:profile.handle});
  } catch(error) {return apiError(error);}
}
