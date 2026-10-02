import {apiError, viewer} from '../../../lib/api';
import {clientIp} from '../../../lib/rate-limit';
import {parseSearch, search, searchRateLimit} from '../../../lib/search/search';
// GET /api/search?q=&type=events|people|schools|posts|venues|all&city=<id or slug>&cursor=&limit=&locale=en|es|ru
// Public data only. Titles and snippets are plain-text segments ({text, hit?}), never HTML.
export async function GET(request: Request) {
  try {
    const user = await viewer(request), limit = await searchRateLimit(clientIp(request), user?.id);
    if (!limit.ok) return Response.json({error: 'RATE_LIMITED'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter), 'Cache-Control': 'no-store'}});
    const result = await search(parseSearch(new URL(request.url).searchParams), user?.profile?.id);
    // Results depend on the viewer's blocks, so they are never shared between visitors.
    return Response.json(result, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return apiError(error);}
}
