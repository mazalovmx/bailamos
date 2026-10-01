import {db} from '@dance/db';
import {apiError} from '../../../../../lib/api';
import {managedEvent} from '../../../../../lib/events/access';
// The team as organizers see it: owner, co-organizers and artists.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {id}=await params;
    await managedEvent(request,id);
    const members=await db.eventMembership.findMany({where:{eventId:id,role:{in:['OWNER','CO_ORGANIZER','ARTIST']}},
      select:{role:true,profile:{select:{id:true,handle:true,name:true,type:true,userId:true}}}});
    return Response.json({members:members.map(m=>({profileId:m.profile.id,handle:m.profile.handle,name:m.profile.name,type:m.profile.type,role:m.role,stub:!m.profile.userId}))});
  } catch(error) {return apiError(error);}
}
