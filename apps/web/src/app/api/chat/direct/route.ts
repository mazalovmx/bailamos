import {apiError, jsonBody} from '../../../../lib/api';
import {chatActor} from '../../../../lib/chat/http';
import {openDirect, profileInput} from '../../../../lib/chat/service';
// Gets or creates the direct conversation with a profile. From a stranger it starts as a request.
export async function POST(request: Request) {
  try {
    const me = await chatActor(request);
    const {profileId} = profileInput.parse(await jsonBody(request));
    const result = await openDirect(me, profileId);
    return Response.json({id: result.id}, {status: result.created ? 201 : 200});
  } catch (error) {return apiError(error);}
}
