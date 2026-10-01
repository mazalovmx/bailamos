import {db} from '@dance/db';
import {actor, apiError, ApiError, jsonBody} from '../../../../lib/api';
import {prepareEvent} from '../../../../lib/event-input';
import {eventAbility} from '../../../../lib/permissions';
export async function PATCH(request: Request, {params}: {params:Promise<{id:string}>}) {
  try {
    const user=await actor(request);
    const {id}=await params;
    const event=await db.event.findUnique({where:{id},include:{members:true}});
    if (!event) throw new ApiError('NOT_FOUND',404);
    if (!eventAbility(user.profile?.id,event.members).can('manage','Event')) throw new ApiError('FORBIDDEN',403);
    const {fields,occurrences,styleId,tagIds}=await prepareEvent(await jsonBody(request));
    await db.event.update({where:{id},data:{...fields,
      styles:{deleteMany:{},create:{styleId}},
      tags:{deleteMany:{},create:tagIds.map(tagId=>({tagId}))},
      occurrences:{deleteMany:{},create:occurrences}
    }});
    return Response.json({slug:event.slug});
  } catch(error) {return apiError(error);}
}
