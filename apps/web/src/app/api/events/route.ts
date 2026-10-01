import {randomUUID} from 'node:crypto';
import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../lib/api';
import {prepareEvent} from '../../../lib/event-input';
import {managesSchool} from '../../../lib/schools/access';
import {ensureShortCode} from '../../../lib/events/short-code';
import {recordParseFeedback} from '../../../lib/events/parse';
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const body=await jsonBody(request);
    // A form pre-filled by the announcement parser is saved only with the organizer's explicit confirmation.
    if (body?.parseId && body.parsedConfirmed!==true) throw new ApiError('PARSE_CONFIRM_REQUIRED',400);
    const {fields,occurrences,styleId,tagIds,schoolProfileId}=await prepareEvent(body);
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
    if (body?.parseId) await recordParseFeedback(body.parseId,body).catch(()=>null);
    return Response.json({id:event.id,slug:event.slug,shortCode},{status:201});
  } catch(error) {return apiError(error);}
}
