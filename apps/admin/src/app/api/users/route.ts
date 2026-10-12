import {addAdminByEmail} from '../../../lib/admin-users';
import {adminOrigin} from '../../../lib/env';
import {jsonBody, route} from '../../../lib/guard';

export const POST = route('OWNER', async (request, user) => {
  const added = await addAdminByEmail(user.id, await jsonBody(request));
  return Response.json({...added, loginUrl: adminOrigin() + '/login'}, {status: added.created ? 201 : 200});
});
