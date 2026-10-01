import {z} from 'zod';
import {ReportReason} from '@dance/db';
import {jsonBody, route} from '../../../../lib/guard';
import {resolutionActions, resolveTarget, targetTypes} from '../../../../lib/moderation';
const schema = z.object({
  targetType: z.enum(targetTypes), targetId: z.string().min(1).max(64), action: z.enum(resolutionActions), banAuthor: z.boolean().default(false),
  reason: z.enum([...Object.values(ReportReason), 'NO_VIOLATION']), comment: z.string().trim().max(1000).optional()
});
export const POST = route('STAFF', async (request, user) => {
  const {targetType, targetId, ...decision} = schema.parse(await jsonBody(request));
  return Response.json(await resolveTarget(targetType, targetId, decision, user.id));
});
