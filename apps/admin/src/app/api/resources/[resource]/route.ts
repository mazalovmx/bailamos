import {create, list} from '../../../../lib/crud';
import {jsonBody, route} from '../../../../lib/guard';
import {resource} from '../../../../lib/resources';
type Context = {params: Promise<{resource: string}>};
export const GET = route<Context>('STAFF', async (request, _user, {params}) =>
  Response.json(await list(resource((await params).resource), new URL(request.url).searchParams)));
export const POST = route<Context>('STAFF', async (request, user, {params}) =>
  Response.json({data: await create(resource((await params).resource), await jsonBody(request), user)}, {status: 201}));
