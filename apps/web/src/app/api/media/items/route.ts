import {db} from '@dance/db';
import {z} from 'zod';
import {actor, jsonBody, viewer} from '../../../../lib/api';
import {lookupEmbed} from '../../../../lib/embeds/instagram';
import {authorizeTarget, canManageEvent, isStaff, ownsPost, profileOf, type MediaUser} from '../../../../lib/media/access';
import {deleteMediaItem} from '../../../../lib/media/cleanup';
import {toMediaDto} from '../../../../lib/media/dto';
import {MediaError} from '../../../../lib/media/errors';
import {clientIp, limited, mediaFail} from '../../../../lib/media/http';
import {altSchema, assertRoom} from '../../../../lib/media/upload';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const parentSchema = z.object({eventId: id.optional(), postId: id.optional()}).refine(p => !!p.eventId !== !!p.postId);
const order = [{position: 'asc' as const}, {createdAt: 'asc' as const}];
// GET /api/media/items?eventId=…|postId=… — visible items of a published event/post; managers also see drafts.
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const parent = parentSchema.parse({eventId: query.get('eventId') || undefined, postId: query.get('postId') || undefined});
    const user = await viewer(request);
    const profileId = user?.profile?.id, staff = !!user && isStaff(user);
    if (parent.eventId) {
      const event = await db.event.findUnique({where: {id: parent.eventId}, select: {status: true, hiddenAt: true}});
      if (!event) throw new MediaError('NOT_FOUND', 404);
      if ((event.status === 'DRAFT' || event.hiddenAt) && !staff && !await canManageEvent(profileId, parent.eventId)) throw new MediaError('NOT_FOUND', 404);
    } else {
      const post = await db.post.findUnique({where: {id: parent.postId}, select: {publishedAt: true, hiddenAt: true, profileId: true}});
      if (!post) throw new MediaError('NOT_FOUND', 404);
      if ((!post.publishedAt || post.hiddenAt) && !staff && post.profileId !== profileId) throw new MediaError('NOT_FOUND', 404);
    }
    const items = await db.mediaItem.findMany({where: {...parent, hiddenAt: null}, orderBy: order, take: 200});
    return Response.json({items: items.map(toMediaDto)});
  } catch (error) {return mediaFail(error);}
}
// POST {eventId|postId, url} — attaches an Instagram post by link. Uploaded photos are created by /api/media/uploads/complete.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const body = z.object({eventId: id.optional(), postId: id.optional(), url: z.string().min(1).max(500)}).parse(await jsonBody(request));
    const parent = parentSchema.parse({eventId: body.eventId, postId: body.postId});
    const where = await authorizeTarget(user, parent.eventId ? 'event' : 'post', parent.eventId || parent.postId);
    await limited('embed:user:' + user.id, {limit: 20, windowSec: 60});
    await limited('embed:ip:' + clientIp(request), {limit: 60, windowSec: 60});
    const {permalink, entry} = await lookupEmbed(body.url);
    const existing = await db.mediaItem.findFirst({where: {...where, kind: 'instagram', sourceUrl: permalink}});
    if (existing) return Response.json({item: toMediaDto(existing), status: entry.status});
    await assertRoom(where);
    const ok = entry.status === 'ok';
    const item = await db.mediaItem.create({data: {
      ...where, kind: 'instagram', sourceUrl: permalink, uploaderProfileId: profileOf(user),
      position: await db.mediaItem.count({where}),
      ...(ok ? {embedHtml: entry.html ?? null, embedMeta: entry.meta, embedFetched: new Date(entry.fetchedAt)} : {})
    }});
    return Response.json({item: toMediaDto(item), status: entry.status}, {status: 201});
  } catch (error) {return mediaFail(error);}
}
// The uploader, whoever manages the parent event or owns the parent post, and moderators may change or remove an item.
async function editable(user: MediaUser, itemId: string) {
  const item = await db.mediaItem.findUnique({where: {id: itemId}});
  if (!item) throw new MediaError('NOT_FOUND', 404);
  const profileId = user.profile?.id;
  const allowed = isStaff(user) || (!!profileId && item.uploaderProfileId === profileId) ||
    (item.eventId ? await canManageEvent(profileId, item.eventId) : !!item.postId && await ownsPost(profileId, item.postId));
  if (!allowed) throw new MediaError('FORBIDDEN', 403);
  return item;
}
// PATCH {id, alt} — sets the alternative text.
export async function PATCH(request: Request) {
  try {
    const user = await actor(request);
    const body = z.object({id, alt: altSchema}).parse(await jsonBody(request));
    await editable(user, body.id);
    const item = await db.mediaItem.update({where: {id: body.id}, data: {alt: body.alt || null}});
    return Response.json({item: toMediaDto(item)});
  } catch (error) {return mediaFail(error);}
}
// DELETE /api/media/items?id=… — removes the item and, for uploads, its stored files.
export async function DELETE(request: Request) {
  try {
    const user = await actor(request);
    const itemId = id.parse(new URL(request.url).searchParams.get('id'));
    await editable(user, itemId);
    await deleteMediaItem(itemId);
    return Response.json({deleted: true});
  } catch (error) {return mediaFail(error);}
}
