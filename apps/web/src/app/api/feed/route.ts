import {apiError, viewer} from '../../../lib/api';
import {currentCitySlug} from '../../../lib/catalogue/current-city';
import {feedPage} from '../../../lib/feed/query';
export const dynamic = 'force-dynamic';
// GET /api/feed?cursor= — the next page of the personal feed; works signed out as well (current city and latest posts).
export async function GET(request: Request) {
  try {
    const user = await viewer(request), cursor = new URL(request.url).searchParams.get('cursor');
    const page = await feedPage({userId: user?.id, profileId: user?.profile?.id, citySlug: await currentCitySlug(), cursor});
    return Response.json(page, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
