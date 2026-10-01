import {z} from 'zod';
import {jsonBody, route} from '../../../../lib/guard';
import {hideTarget, targetTypes, unhideTarget} from '../../../../lib/moderation';
const schema = z.object({targetType: z.enum(targetTypes), targetId: z.string().min(1).max(64), hidden: z.boolean(), reason: z.string().trim().min(1).max(1000)});
export const POST = route('STAFF', async (request, user) => {
  const {targetType, targetId, hidden, reason} = schema.parse(await jsonBody(request));
  await (hidden ? hideTarget : unhideTarget)(targetType, targetId, user.id, reason);
  return Response.json({hidden});
});
