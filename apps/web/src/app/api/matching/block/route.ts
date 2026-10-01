import {apiError, jsonBody} from '../../../../lib/api';
import {limited, profileActor} from '../../../../lib/matching/http';
import {blockProfile, limits, profileInput, unblockProfile} from '../../../../lib/matching/interest';
// Block from a candidate card: writes Block and removes the interests in both directions.
export async function PUT(request: Request) {
  try {
    const me = await profileActor(request);
    await limited('mutate:' + me.userId, limits.mutate);
    return Response.json(await blockProfile(me.profileId, profileInput.parse(await jsonBody(request)).profileId));
  } catch (error) {return apiError(error);}
}
export async function DELETE(request: Request) {
  try {
    const me = await profileActor(request);
    return Response.json(await unblockProfile(me.profileId, profileInput.parse(await jsonBody(request)).profileId));
  } catch (error) {return apiError(error);}
}
