import {apiError} from '../../../../../../lib/api';
import {managedEvent} from '../../../../../../lib/events/access';
import {detachArtist} from '../../../../../../lib/events/artists';
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;profileId:string}>}) {
  try {
    const {id,profileId}=await params;
    await managedEvent(request,id);
    await detachArtist(id,profileId);
    return Response.json({removed:true});
  } catch(error) {return apiError(error);}
}
