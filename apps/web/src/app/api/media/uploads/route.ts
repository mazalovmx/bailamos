import {actor, jsonBody} from '../../../../lib/api';
import {uploadsPerHour} from '../../../../lib/media/config';
import {limited, mediaFail} from '../../../../lib/media/http';
import {startUpload} from '../../../../lib/media/upload';
// Step 1 of an upload: returns {key, uploadUrl, headers}; the browser then PUTs the file to uploadUrl with those headers.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const body = await jsonBody(request);
    await limited('media-upload:' + user.id, {limit: uploadsPerHour(), windowSec: 3600});
    return Response.json(await startUpload(user, body), {status: 201, headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return mediaFail(error);}
}
