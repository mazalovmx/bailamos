import {apiError} from '../../../../lib/api';
import {limited, noStore, searchViewer} from '../../../../lib/matching/http';
import {candidateQuery, findCandidates} from '../../../../lib/matching/search';
import {limits, touchActivity} from '../../../../lib/matching/interest';
// Partner candidates for the signed-in searcher: ?style=&subStyles=1&widen=1&cityId=|radiusKm=10|25|50|100&offset=&limit=
// The response carries a distance band at most; coordinates and distances stay on the server.
export async function GET(request: Request) {
  try {
    const me = await searchViewer(request);
    await limited('search:' + me.userId, limits.search);
    const query = candidateQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    void touchActivity(me.profileId).catch(() => undefined);
    return Response.json(await findCandidates(me, query), {headers: noStore});
  } catch (error) {return apiError(error);}
}
