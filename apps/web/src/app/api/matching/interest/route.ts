import {apiError, jsonBody} from '../../../../lib/api';
import {limited, profileActor, searchActor} from '../../../../lib/matching/http';
import {expressInterest, interestInput, limits, profileInput, withdrawInterest} from '../../../../lib/matching/interest';
// One-directional interest. The response says `matched` only to the person who just completed the pair.
export async function PUT(request: Request) {
  try {
    const me = await searchActor(request);
    await limited('mutate:' + me.userId, limits.mutate);
    return Response.json(await expressInterest(me, interestInput.parse(await jsonBody(request))));
  } catch (error) {return apiError(error);}
}
// Withdrawing never needs eligibility: it must stay possible after partner search is switched off.
export async function DELETE(request: Request) {
  try {
    const me = await profileActor(request);
    return Response.json(await withdrawInterest(me.profileId, profileInput.parse(await jsonBody(request)).profileId));
  } catch (error) {return apiError(error);}
}
