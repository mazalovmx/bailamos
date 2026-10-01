import {z} from 'zod';
import {actor, jsonBody} from '../../../lib/api';
import {resolveEmbed} from '../../../lib/embeds/instagram';
import {clientIp, limited, mediaFail} from '../../../lib/media/http';
// Instagram oEmbed proxy. Signed-in users only, limited per user and per address. Invalid and profile links are 400s
// with a translatable code; every upstream problem is a 200 with status "degraded" (a plain link card).
// `html` is Meta's markup kept for reference — the site renders its own card and never injects it.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const {url} = z.object({url: z.string().min(1).max(500)}).parse(await jsonBody(request));
    await limited('embed:user:' + user.id, {limit: 20, windowSec: 60});
    await limited('embed:ip:' + clientIp(request), {limit: 60, windowSec: 60});
    return Response.json(await resolveEmbed(url), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return mediaFail(error);}
}
