import {z} from 'zod';
import {UserRole} from '@dance/db';
import {jsonBody, route} from '../../../../../lib/guard';
import {setUserRole} from '../../../../../lib/moderation';
const schema = z.object({role: z.enum(UserRole)});
export const POST = route<{params: Promise<{id: string}>}>('ADMIN', async (request, user, {params}) => {
  const {id} = await params, {role} = schema.parse(await jsonBody(request));
  await setUserRole(id, role, user.id);
  return Response.json({role});
});
