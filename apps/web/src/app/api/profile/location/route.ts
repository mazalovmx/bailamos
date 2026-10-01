import {apiError, jsonBody} from '../../../../lib/api';
import {limited, profileActor} from '../../../../lib/matching/http';
import {limits, locationInput, setLocation} from '../../../../lib/matching/interest';
// Body: {lat, lng, district?} or null to clear. Only the coarsened grid cell is stored, and nothing is echoed back.
export async function PUT(request: Request) {
  try {
    const me = await profileActor(request);
    const input = locationInput.parse(await jsonBody(request));
    // Clearing is never limited: removing your position must always work.
    if (input !== null) await limited('location:' + me.userId, limits.location);
    return Response.json(await setLocation(me.profileId, input));
  } catch (error) {return apiError(error);}
}
