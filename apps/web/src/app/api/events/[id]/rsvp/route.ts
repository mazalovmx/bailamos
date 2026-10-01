import {db} from '@dance/db';
import {z} from 'zod';
import {actor, apiError, ApiError, jsonBody} from '../../../../../lib/api';
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const {id}=await params;
    const {status}=z.object({status:z.enum(['GOING','INTERESTED','DECLINED'])}).parse(await jsonBody(request));
    const event=await db.event.findUnique({where:{id},include:{occurrences:{where:{startsAt:{gte:new Date()},cancelled:false},take:1}}});
    if (!event || event.status!=='PUBLISHED' || !event.occurrences.length) throw new ApiError('EVENT_UNAVAILABLE',400);
    await db.rsvp.upsert({where:{eventId_profileId:{eventId:id,profileId:user.profile.id}},
      create:{eventId:id,profileId:user.profile.id,status},update:{status}});
    return Response.json({status});
  } catch(error) {return apiError(error);}
}
