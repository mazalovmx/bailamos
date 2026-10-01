import {z} from 'zod';
import {jsonBody, route} from '../../../../lib/guard';
import {decideClaim} from '../../../../lib/moderation';
const schema = z.object({approve: z.boolean(), reason: z.string().trim().max(1000).optional()});
export const POST = route<{params: Promise<{id: string}>}>('STAFF', async (request, user, {params}) => {
  const {id} = await params, {approve, reason} = schema.parse(await jsonBody(request));
  return Response.json(await decideClaim(id, approve, user.id, reason));
});
