import {db} from '@dance/db';
import {apiError, ApiError} from '../../../../../../lib/api';
import {managedEvent} from '../../../../../../lib/events/access';
// Revokes a pending invitation: its link stops working at once.
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;inviteId:string}>}) {
  try {
    const {id,inviteId}=await params;
    await managedEvent(request,id,'team');
    const removed=await db.eventInvite.deleteMany({where:{id:inviteId,eventId:id,acceptedAt:null}});
    if (!removed.count) throw new ApiError('NOT_FOUND',404);
    return Response.json({revoked:true});
  } catch(error) {return apiError(error);}
}
