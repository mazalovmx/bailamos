import {viewer, apiError, ApiError} from '../../../../lib/api';
import {exportUserData} from '../../../../lib/account/export';
export const dynamic = 'force-dynamic';
// A banned user can still download their own data.
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    const data = await exportUserData(user.id);
    if (!data) throw new ApiError('UNAUTHORIZED', 401);
    return new Response(JSON.stringify(data, null, 2), {headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'attachment; filename="dance-community-data-' + new Date().toISOString().slice(0, 10) + '.json"'}});
  } catch (error) {return apiError(error);}
}
