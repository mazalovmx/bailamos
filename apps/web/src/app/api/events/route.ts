import {randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {prepareEvent} from '../../../lib/event-input';
import {ensureShortCode} from '../../../lib/events/short-code';
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const {fields,occurrences,styleId,tagIds}=await prepareEvent(await jsonBody(request));
    if (fields.status === 'CANCELLED') throw new ApiError('INVALID_INPUT',400);
    if (fields.startsAt < new Date()) throw new ApiError('INVALID_TIME',400);
    const event = await db.event.create({data:{
      ...fields, slug:'event-' + randomUUID(),
      styles:{create:{styleId}}, members:{create:{profileId:user.profile.id,role:'OWNER'}},
      tags:{create:tagIds.map(tagId=>({tagId}))},occurrences:{create:occurrences}
    }});
    // The short link exists from the first publication on and never changes afterwards.
    const shortCode=event.status==='PUBLISHED'?await ensureShortCode(event.id):null;
    return Response.json({id:event.id,slug:event.slug,shortCode},{status:201});
  } catch(error) {return apiError(error);}
}
