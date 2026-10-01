import {db, type Prisma} from '@dance/db';
import {actor, ApiError} from '../api';
import {eventAbility} from '../permissions';
export type EventAction='manage'|'delete'|'team';
// What anonymous visitors may see: published (and cancelled, so that a shared link explains itself), never hidden.
export const publicEvent={status:{in:['PUBLISHED','CANCELLED']},hiddenAt:null} satisfies Prisma.EventWhereInput;
export function isPublic(event:{status:string;hiddenAt:Date|null}) {
  return event.status!=='DRAFT'&&!event.hiddenAt;
}
// Every mutation of an event goes through here: signed-in, verified, not banned, and allowed by CASL for this event.
export async function managedEvent(request:Request,id:string,action:EventAction='manage') {
  const user=await actor(request);
  const event=await db.event.findUnique({where:{id},include:{members:true}});
  if(!event) throw new ApiError('NOT_FOUND',404);
  const ability=eventAbility(user.profile?.id,event.members);
  if(!ability.can(action,'Event')) throw new ApiError('FORBIDDEN',403);
  return {user,event,profile:user.profile!};
}
