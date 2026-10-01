import {apiError} from '../../../../lib/api';
import {allCities} from '../../../../lib/catalogue/data';
import {rankMatches} from '../../../../lib/catalogue/search';
export async function GET(request: Request) {
  try {
    const items = rankMatches(await allCities(), new URL(request.url).searchParams.get('q') || '', 10);
    return Response.json({items}, {headers: {'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600'}});
  } catch (error) {return apiError(error);}
}
