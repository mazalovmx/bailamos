import {randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {prepareEvent} from '../../../lib/event-input';
import {managesSchool} from '../../../lib/schools/access';
import {ensureShortCode} from '../../../lib/events/short-code';
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const body=await jsonBody(request);
    const {fields,occurrences,styleId,tagIds,schoolProfileId,exactPlace}=await prepareEvent(body);
    // Every event has an exact marker: an event in a park or on a square has no address to fall back on.
    if (!exactPlace) throw new ApiError('PLACE_REQUIRED',400);
    if (fields.mapImageKey && !fields.mapImageKey.startsWith('img/'+user.profile.id+'/')) throw new ApiError('INVALID_MAP_IMAGE',400);
    // An event may be published in a school's name only by someone who manages that school.
    if (schoolProfileId && !managesSchool(user,schoolProfileId)) throw new ApiError('FORBIDDEN',403);
    const school=schoolProfileId&&schoolProfileId!==user.profile.id?[{profileId:schoolProfileId,role:'CO_ORGANIZER' as const}]:[];
    if (fields.status === 'CANCELLED') throw new ApiError('INVALID_INPUT',400);
    if (fields.startsAt < new Date()) throw new ApiError('INVALID_TIME',400);
    const event = await db.event.create({data:{
      ...fields, slug:'event-' + randomUUID(), schoolProfileId,
      styles:{create:{styleId}}, members:{create:[{profileId:user.profile.id,role:'OWNER'},...school]},
      tags:{create:tagIds.map(tagId=>({tagId}))},occurrences:{create:occurrences}
    }});
    // The short link exists from the first publication on and never changes afterwards.
    const shortCode=event.status==='PUBLISHED'?await ensureShortCode(event.id):null;
    return Response.json({id:event.id,slug:event.slug,shortCode},{status:201});
  } catch(error) {return apiError(error);}
}
