import {apiError, jsonBody} from '../../../../lib/api';
import {chatActor, chatViewer, noStore} from '../../../../lib/chat/http';
import {blockProfile, listBlocks, profileInput, unblockProfile} from '../../../../lib/chat/service';
export async function GET(request: Request) {
  try {return Response.json({blocks: await listBlocks(await chatViewer(request))}, {headers: noStore});} catch (error) {return apiError(error);}
}
export async function PUT(request: Request) {
  try {
    const me = await chatActor(request);
    return Response.json(await blockProfile(me, profileInput.parse(await jsonBody(request)).profileId));
  } catch (error) {return apiError(error);}
}
export async function DELETE(request: Request) {
  try {
    const me = await chatActor(request);
    return Response.json(await unblockProfile(me, profileInput.parse(await jsonBody(request)).profileId));
  } catch (error) {return apiError(error);}
}
