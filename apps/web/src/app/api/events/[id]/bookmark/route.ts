import {db} from '@dance/db';
import {actor,apiError,ApiError} from '../../../../../lib/api';
import {publicEvent} from '../../../../../lib/events/access';
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){try{
  const user=await actor(request),{id}=await params;
  if(!await db.event.count({where:{id,...publicEvent}}))throw new ApiError('NOT_FOUND',404);
  await db.eventBookmark.upsert({where:{userId_eventId:{userId:user.id,eventId:id}},create:{userId:user.id,eventId:id},update:{}});
  return Response.json({saved:true});
}catch(error){return apiError(error);}}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){try{
  const user=await actor(request),{id}=await params;await db.eventBookmark.deleteMany({where:{userId:user.id,eventId:id}});return Response.json({saved:false});
}catch(error){return apiError(error);}}
