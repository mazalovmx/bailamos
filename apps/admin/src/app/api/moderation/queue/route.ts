import {route} from '../../../../lib/guard';
import {moderationQueue} from '../../../../lib/queue';
export const GET = route('STAFF', async request =>
  Response.json(await moderationQueue(Math.max(1, Math.trunc(Number(new URL(request.url).searchParams.get('page')) || 1)))));
