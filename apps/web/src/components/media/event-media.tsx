import '../../app/styles/media.css';
import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {toMediaDto} from '../../lib/media/dto';
import {maxBytes} from '../../lib/media/config';
import {EventMediaManager} from './event-media-manager';
import {MediaGallery} from './gallery';
/**
 * Photos and Instagram cards of an event. Rendering uses only data already stored in Postgres, so the page renders
 * the same when Meta is unreachable. `canManage` (event OWNER / CO_ORGANIZER) adds the upload and link forms.
 */
export async function EventMedia({eventId, canManage}: {eventId: string; canManage: boolean}) {
  const [t, rows] = await Promise.all([
    getTranslations('Media'),
    db.mediaItem.findMany({where: {eventId, hiddenAt: null}, orderBy: [{position: 'asc'}, {createdAt: 'asc'}], take: 200})
  ]);
  const items = rows.map(toMediaDto);
  if (!items.length && !canManage) return null;
  return <section className="media-section" aria-labelledby="event-media-title">
    <h2 id="event-media-title">{t('galleryTitle')}</h2>
    {canManage ? <EventMediaManager eventId={eventId} initial={items} maxBytes={maxBytes()}/> : <MediaGallery items={items}/>}
  </section>;
}
