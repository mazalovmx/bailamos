import {db} from '@dance/db';
import {apiError, ApiError} from '../../../../../lib/api';
import {isPublic} from '../../../../../lib/events/access';
import {mediaUrl} from '../../../../../lib/media/url';
// GET /api/events/[id]/place — the photo and the short note an organizer attached for the map. Public events only.
export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params;
    const event = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await db.event.findUnique({where: {id}, select: {status: true, hiddenAt: true, mapImageKey: true, mapNote: true}}) : null;
    if (!event || !isPublic(event)) throw new ApiError('NOT_FOUND', 404);
    return Response.json({note: event.mapNote, image: event.mapImageKey ? mediaUrl(event.mapImageKey) : null}, {headers: {'Cache-Control': 'public, max-age=300'}});
  } catch (error) {return apiError(error);}
}
