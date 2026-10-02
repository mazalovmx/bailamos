import {actor, apiError, ApiError, jsonBody} from '../../../../../../../lib/api';
import {rsvpInput} from '../../../../../../../lib/events/schema';
import {answerDate} from '../../../../../../../lib/events/date-rsvp';
type Context={params:Promise<{id:string;occurrenceId:string}>};
async function answer(request:Request,{params}:Context,read:()=>Promise<'GOING'|'INTERESTED'|'DECLINED'|null>) {
  try {
    const user=await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED',400);
    const {id,occurrenceId}=await params;
    return Response.json(await answerDate(id,occurrenceId,user.profile,await read()));
  } catch(error) {return apiError(error);}
}
// An answer for one date of a series. It overrides the answer for the whole series on that date only:
// GOING, INTERESTED, or DECLINED for "not this date".
export const PUT=(request:Request,context:Context)=>answer(request,context,async()=>rsvpInput.parse(await jsonBody(request)).status);
// Removes the answer for the date: the answer for the whole series counts again.
export const DELETE=(request:Request,context:Context)=>answer(request,context,async()=>null);
