import {apiError} from '../../../../lib/api';
import {allStyles} from '../../../../lib/catalogue/data';
import {rankMatches} from '../../../../lib/catalogue/search';
const cacheControl = 'public, max-age=300, stale-while-revalidate=3600';
export async function GET(request: Request) {
  try {
    const styles = await allStyles(), names = new Map(styles.map(style => [style.id, style.name]));
    const items = rankMatches(styles, new URL(request.url).searchParams.get('q') || '', 10)
      .map(style => ({id: style.id, slug: style.slug, name: style.name, parentName: style.parentId ? names.get(style.parentId) || null : null}));
    return Response.json({items}, {headers: {'Cache-Control': cacheControl}});
  } catch (error) {return apiError(error);}
}
