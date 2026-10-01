import {actor, jsonBody} from '../../../../../lib/api';
import {uploadsPerHour} from '../../../../../lib/media/config';
import {limited, mediaFail} from '../../../../../lib/media/http';
import {completeUpload} from '../../../../../lib/media/upload';
// Step 2 of an upload: verifies and re-encodes the stored object, then records it. Image work needs the Node runtime.
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const body = await jsonBody(request);
    // Processing is the expensive part, so retries are counted separately from issued upload URLs.
    await limited('media-complete:' + user.id, {limit: uploadsPerHour() * 2, windowSec: 3600});
    return Response.json(await completeUpload(user, body), {status: 201});
  } catch (error) {return mediaFail(error);}
}
