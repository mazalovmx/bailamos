import {actor, apiError, jsonBody} from '../../../../lib/api';
import {inviteAnswer} from '../../../../lib/events/schema';
import {answerInvite} from '../../../../lib/events/invites';
// Accepts or declines a co-organizer invitation. The signed-in, verified user must be its addressee.
export async function POST(request:Request,{params}:{params:Promise<{token:string}>}) {
  try {
    const user=await actor(request),{token}=await params;
    const {action}=inviteAnswer.parse(await jsonBody(request));
    return Response.json(await answerInvite(token,user,action));
  } catch(error) {return apiError(error);}
}
