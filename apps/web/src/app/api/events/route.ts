import {randomUUID} from 'node:crypto';
import {db,eventShortCode} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {prepareEvent} from '../../../lib/event-input';
import {managesSchool} from '../../../lib/schools/access';
import {z} from 'zod';
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const body=await jsonBody(request);
    const operationId=z.string().uuid().optional().parse(body?.operationId);
    const creationKey=operationId?user.id+':'+operationId:null;
    if(creationKey){const prior=await db.event.findUnique({where:{creationKey}});if(prior)return Response.json({id:prior.id,slug:prior.slug,shortCode:prior.shortCode,version:prior.version},{status:200});}
    const prepared=await prepareEvent(body);
    const {fields,occurrences,styleId,tagIds,exactPlace}=prepared;
    const schoolProfileId=prepared.schoolProfileId||(user.profile.type==='SCHOOL'?user.profile.id:null);
    // Every event has an exact marker: an event in a park or on a square has no address to fall back on.
    if (!exactPlace) throw new ApiError('PLACE_REQUIRED',400);
    if (fields.mapImageKey && !fields.mapImageKey.startsWith('img/'+user.profile.id+'/')) throw new ApiError('INVALID_MAP_IMAGE',400);
    // An event may be published in a school's name only by someone who manages that school.
    if (schoolProfileId && !managesSchool(user,schoolProfileId)) throw new ApiError('FORBIDDEN',403);
    const school=schoolProfileId&&schoolProfileId!==user.profile.id?[{profileId:schoolProfileId,role:'CO_ORGANIZER' as const}]:[];
    if (fields.status === 'CANCELLED') throw new ApiError('INVALID_INPUT',400);
    if (fields.startsAt < new Date()) throw new ApiError('INVALID_TIME',400);
    const data={
      ...fields, slug:'event-' + randomUUID(), schoolProfileId,creationKey,
      shortCode:fields.status==='PUBLISHED'?eventShortCode():null,
      styles:{create:{styleId}}, members:{create:[{profileId:user.profile.id,role:'OWNER' as const},...school]},
      tags:{create:tagIds.map(tagId=>({tagId}))},occurrences:{create:occurrences}
    };
    const event = await db.event.create({data}).catch(async error=>{if(creationKey){const prior=await db.event.findUnique({where:{creationKey}});if(prior)return prior;}throw error;});
    return Response.json({id:event.id,slug:event.slug,shortCode:event.shortCode,version:event.version},{status:201});
  } catch(error) {return apiError(error);}
}
