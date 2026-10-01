import {z} from 'zod';
import {jsonBody, route} from '../../../../../lib/guard';
import {banUser, unbanUser} from '../../../../../lib/moderation';
const schema = z.object({banned: z.boolean(), reason: z.string().trim().min(1).max(1000)});
export const POST = route<{params: Promise<{id: string}>}>('STAFF', async (request, user, {params}) => {
  const {id} = await params, {banned, reason} = schema.parse(await jsonBody(request));
  if (banned) await banUser(id, reason, user.id); else await unbanUser(id, user.id, reason);
  return Response.json({banned});
});
