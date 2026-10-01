import {db} from '@dance/db';
import {apiError, jsonBody} from '../../../../../lib/api';
import {managedEvent} from '../../../../../lib/events/access';
import {inviteInput} from '../../../../../lib/events/schema';
import {createInvite, pendingInvites} from '../../../../../lib/events/invites';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context) {
  try {
    const {id}=await params;
    await managedEvent(request,id,'team');
    return Response.json({invites:await pendingInvites(id)});
  } catch(error) {return apiError(error);}
}
// Invites a co-organizer by public handle or by email. For an email the answer never depends on whether an account exists.
export async function POST(request:Request,{params}:Context) {
  try {
    const {id}=await params;
    const {event,user,profile}=await managedEvent(request,id,'team');
    const target=inviteInput.parse(await jsonBody(request));
    const inviter=await db.user.findUnique({where:{id:user.id},select:{locale:true}});
    const invite=await createInvite(event,{profileId:profile.id,name:profile.name,locale:inviter?.locale},target);
    return Response.json({id:invite.id,handle:invite.handle,email:invite.email,expiresAt:invite.expiresAt},{status:201});
  } catch(error) {return apiError(error);}
}
