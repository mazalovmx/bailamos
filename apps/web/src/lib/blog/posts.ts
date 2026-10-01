import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {deleteMediaItem} from '../media/cleanup';
import {parseContent} from './content';
import {emptyDoc, excerptOf, imagesOf, isEmptyDoc} from './nodes';
import {canPost, type PostAction} from './permissions';
import {randomSuffix, slugBase, uniqueSlug} from './slug';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const postId = id;
export const createInput = z.strictObject({title: z.string().trim().max(200).optional()});
// `content` is checked separately by parseContent, against the media of the post.
export const patchInput = z.strictObject({title: z.string().trim().max(200).optional(), content: z.unknown().optional(),
  eventId: id.nullable().optional(), published: z.boolean().optional()});
export type PatchInput = z.infer<typeof patchInput>;
type Viewer = {role?: string; profile?: {id: string} | null} | null;
/** What anonymous visitors may see: published, not hidden by moderation, written by a profile that is itself visible. */
export const publicPostWhere = {publishedAt: {not: null}, hiddenAt: null, profile: {hiddenAt: null}} satisfies Prisma.PostWhereInput;
export const publicEventWhere = {status: 'PUBLISHED', hiddenAt: null} satisfies Prisma.EventWhereInput;
export function profileIdOf(user: Viewer) {
  if (!user?.profile) throw new ApiError('PROFILE_REQUIRED', 400);
  return user.profile.id;
}
/** Loads a post for an action. A post the viewer may not even read does not exist for them (404, not 403). */
export async function postFor(user: Viewer, postIdValue: string, action: PostAction) {
  const post = await db.post.findUnique({where: {id: id.parse(postIdValue)}});
  if (!post || !canPost(user, 'read', post)) throw new ApiError('NOT_FOUND', 404);
  if (!canPost(user, action, post)) throw new ApiError('FORBIDDEN', 403);
  return post;
}
export const createDraft = (profileId: string, title = '') =>
  db.post.create({data: {profileId, title, content: emptyDoc()}, select: {id: true}});
type Stored = {id: string; slug: string | null; title: string; content: unknown; publishedAt: Date | null};
/**
 * Applies an edit: title, body, the "I was here" event, and/or the published state. The body is validated against the
 * uploads of this post; uploads the new body no longer shows are deleted together with their files, so a removed photo
 * does not stay reachable through the media API.
 */
export async function savePost(post: Stored, input: PatchInput) {
  const data: Prisma.PostUncheckedUpdateInput = {};
  let title = post.title, content = post.content;
  if (input.title !== undefined) data.title = title = input.title;
  let unused: string[] = [];
  if (input.content !== undefined) {
    const media = await db.mediaItem.findMany({where: {postId: post.id, kind: 'upload', hiddenAt: null}, select: {id: true, storageKey: true, width: true, height: true}});
    const parsed = parseContent(input.content, new Map(media.map(item => [item.id, item])));
    const used = new Set(imagesOf(parsed).map(image => image.mediaId));
    unused = media.filter(item => !used.has(item.id)).map(item => item.id);
    data.content = content = parsed;
    data.excerpt = excerptOf(parsed) || null;
  }
  if (input.eventId !== undefined) {
    if (input.eventId && !await db.event.findFirst({where: {id: input.eventId, ...publicEventWhere}, select: {id: true}})) throw new ApiError('EVENT_NOT_FOUND', 400);
    data.eventId = input.eventId;
  }
  const publish = input.published ?? !!post.publishedAt;
  if (publish) {
    // The rules of a published post hold for every later edit as well.
    if (title.trim().length < 3) throw new ApiError('TITLE_REQUIRED', 400);
    if (isEmptyDoc(content)) throw new ApiError('POST_EMPTY', 400);
    if (!post.publishedAt) data.publishedAt = new Date();
    // The address is made once, on first publication, and survives renames and unpublishing.
    if (!post.slug) data.slug = await uniqueSlug(title, async slug => !!await db.post.findUnique({where: {slug}, select: {id: true}}));
  } else if (input.published === false) data.publishedAt = null;
  const select = {id: true, slug: true, title: true, excerpt: true, eventId: true, publishedAt: true, updatedAt: true, profile: {select: {handle: true}}} as const;
  let saved;
  try {saved = await db.post.update({where: {id: post.id}, data, select});}
  catch (error) {
    // Two posts raced for the same slug: the loser gets a random suffix.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && data.slug)) throw error;
    saved = await db.post.update({where: {id: post.id}, data: {...data, slug: slugBase(title) + '-' + randomSuffix()}, select});
  }
  for (const mediaId of unused) await deleteMediaItem(mediaId).catch(() => {});
  return saved;
}
/** Deletes the post with every media item it owns; uploaded files leave storage as well. */
export async function removePost(postIdValue: string) {
  const media = await db.mediaItem.findMany({where: {postId: postIdValue}, select: {id: true}});
  for (const item of media) await deleteMediaItem(item.id);
  await db.post.delete({where: {id: postIdValue}});
}
export const cardSelect = {
  id: true, slug: true, title: true, excerpt: true, publishedAt: true,
  profile: {select: {handle: true, name: true}},
  media: {where: {kind: 'upload', hiddenAt: null}, orderBy: [{position: 'asc'}, {createdAt: 'asc'}], take: 1,
    select: {storageKey: true, width: true, height: true, alt: true}}
} satisfies Prisma.PostSelect;
export type PostCardData = Prisma.PostGetPayload<{select: typeof cardSelect}>;
/** Published posts, newest first. `before` continues a list after the post published at that moment. */
export function publicPosts(filter: {profileId?: string; eventId?: string}, take = 10, before?: Date) {
  return db.post.findMany({where: {...publicPostWhere, ...filter, ...(before ? {publishedAt: {lt: before}} : {})},
    orderBy: [{publishedAt: 'desc'}, {id: 'desc'}], take: Math.min(Math.max(take, 1), 50), select: cardSelect});
}
export const ownPosts = (profileId: string) => db.post.findMany({where: {profileId}, orderBy: [{updatedAt: 'desc'}], take: 200,
  select: {id: true, slug: true, title: true, excerpt: true, publishedAt: true, hiddenAt: true, updatedAt: true}});
