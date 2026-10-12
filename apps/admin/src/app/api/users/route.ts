import {addAdminByEmail} from '../../../lib/admin-users';
import {adminOrigin} from '../../../lib/env';
import {jsonBody, route} from '../../../lib/guard';
import {grantSchool} from '../../../lib/schools';
import {z} from 'zod';

const schoolInput = z.strictObject({email: z.string(), scope: z.literal('school'), schoolId: z.string().min(1), role: z.enum(['ADMIN','MANAGER']).default('ADMIN')});

export const POST = route('OWNER', async (request, user) => {
  const input = await jsonBody(request);
  let added;
  if (input && typeof input === 'object' && 'scope' in input && input.scope === 'school') {
    const {email, schoolId, role} = schoolInput.parse(input);
    added = await grantSchool(user.id, schoolId, {email, role});
  } else {
    const global = z.strictObject({email: z.string(), scope: z.literal('global').optional(), role: z.enum(['ADMIN','MODERATOR']).optional()}).parse(input);
    added = await addAdminByEmail(user.id, {email: global.email, ...(global.role ? {role: global.role} : {})});
  }
  return Response.json({...added, loginUrl: adminOrigin() + '/login'}, {status: added.created ? 201 : 200});
});
