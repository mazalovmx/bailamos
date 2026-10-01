import {db, Prisma} from '@dance/db';
import {z} from 'zod';
import {ApiError} from '../api';
import {deleteMediaItem} from '../media/cleanup';
import type {EmbedDeps} from '../embeds/instagram';
import {managesSchool} from '../schools/access';
import {parseContent} from './content';
import {MAX_POST_EMBEDS, syncPostEmbeds} from './embeds';
import {embedsOf, emptyDoc, excerptOf, imagesOf, isEmptyDoc} from './nodes';
import {canPost, type PostAction} from './permissions';
import {randomSuffix, slugBase, uniqueSlug} from './slug';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const postId = id;
// `profileId` is the "published by" choice: the author's own profile (the default) or a school the author manages.
export const createInput = z.strictObject({title: z.string().trim().max(200).optional(), profileId: id.optional()});
// `content` is checked separately by parseContent, against the media of the post. `updatedAt` is the version the
// editor started from: a write based on an older version is refused. `autosave` marks a write nobody asked for.
export const patchInput = z.strictObject({title: z.string().trim().max(200).optional(), content: z.unknown().optional(),
  eventId: id.nullable().optional(), published: z.boolean().optional(), updatedAt: z.string().datetime().optional(), autosave: z.boolean().optional()})
  .refine(input => !(input.autosave && input.published !== undefined));
export type PatchInput = z.infer<typeof patchInput>;
type Viewer = {role?: string; profile?: {id: string} | null; schoolIds?: string[]} | null;
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
/**
 * The profile a new post is published by: the author's own one, or a visible school the author manages.
 * A post in a school's name belongs to the school (profileId) and is marked with schoolProfileId.
 */
export async function publisherFor(user: Viewer, wanted?: string) {
  const own = profileIdOf(user);
  if (!wanted || wanted === own) return {profileId: own, schoolProfileId: null};
  if (!managesSchool(user, wanted)) throw new ApiError('FORBIDDEN', 403);
  if (!await db.profile.findFirst({where: {id: wanted, type: 'SCHOOL', hiddenAt: null}, select: {id: true}})) throw new ApiError('FORBIDDEN', 403);
  return {profileId: wanted, schoolProfileId: wanted};
}
export const createDraft = (profileId: string, title = '', schoolProfileId: string | null = null) =>
  db.post.create({data: {profileId, schoolProfileId, title, content: emptyDoc()}, select: {id: true}});
type Stored = {id: string; slug: string | null; title: string; content: unknown; publishedAt: Date | null};
export type SaveOptions = {/** Who saves: recorded as the uploader of new embed rows. */ actorProfileId?: string | null; embedDeps?: EmbedDeps};
/**
 * Applies an edit: title, body, the "I was here" event, and/or the published state. The body is validated against the
 * uploads of this post; uploads the new body no longer shows are deleted together with their files, so a removed photo
 * does not stay reachable through the media API. Media rows follow the body: order and descriptions of the photos, and
 * one row per Instagram block.
 *
 * An autosave never touches a published post and never deletes a photo (the author may still undo the removal).
 * `firstPublished` is true for exactly one write per post — the one that gave it its address.
 */
export async function savePost(post: Stored, input: PatchInput, options: SaveOptions = {}) {
  if (input.autosave && post.publishedAt) throw new ApiError('AUTOSAVE_PUBLISHED', 409);
  const data: Prisma.PostUncheckedUpdateManyInput = {};
  let title = post.title, content = post.content;
  if (input.title !== undefined) data.title = title = input.title;
  let unused: string[] = [], follow: (() => Promise<unknown>)[] = [];
  if (input.content !== undefined) {
    const media = await db.mediaItem.findMany({where: {postId: post.id, kind: 'upload', hiddenAt: null},
      select: {id: true, storageKey: true, width: true, height: true, alt: true, position: true}});
    const parsed = parseContent(input.content, new Map(media.map(item => [item.id, item])));
    if (embedsOf(parsed).length > MAX_POST_EMBEDS) throw new ApiError('EMBED_LIMIT', 400);
    const images = imagesOf(parsed), used = new Set(images.map(image => image.mediaId));
    unused = media.filter(item => !used.has(item.id)).map(item => item.id);
    // The first photo of the body is the one cards show, and galleries read the description from the media item.
    follow = [...used].flatMap(mediaId => {
      const position = images.findIndex(image => image.mediaId === mediaId), item = media.find(row => row.id === mediaId);
      const alt = images[position].alt.trim().slice(0, 300) || null;
      return item && (item.position !== position || item.alt !== alt) ? [() => db.mediaItem.updateMany({where: {id: mediaId, postId: post.id}, data: {position, alt}})] : [];
    });
    follow.push(() => syncPostEmbeds(post.id, parsed, options.actorProfileId, options.embedDeps));
    data.content = content = parsed;
    data.excerpt = excerptOf(parsed) || null;
  }
  if (input.eventId !== undefined) {
    if (input.eventId && !await db.event.findFirst({where: {id: input.eventId, ...publicEventWhere}, select: {id: true}})) throw new ApiError('EVENT_NOT_FOUND', 400);
    data.eventId = input.eventId;
  }
  const publish = input.published ?? !!post.publishedAt;
  // The address is made once, on first publication, and survives renames and unpublishing.
  const first = publish && !post.slug;
  if (publish) {
    // The rules of a published post hold for every later edit as well.
    if (title.trim().length < 3) throw new ApiError('TITLE_REQUIRED', 400);
    if (isEmptyDoc(content)) throw new ApiError('POST_EMPTY', 400);
    if (!post.publishedAt) data.publishedAt = new Date();
    if (first) data.slug = await uniqueSlug(title, async slug => !!await db.post.findUnique({where: {slug}, select: {id: true}}));
  } else if (input.published === false) data.publishedAt = null;
  const expected = input.updatedAt ? new Date(input.updatedAt) : null;
  // One conditional write: it happens only if nobody saved since the editor loaded the post (when a version was sent),
  // and only one of two racing first publications gets to set the address.
  const write = async (values: Prisma.PostUncheckedUpdateManyInput, claim: boolean) => {
    const where = {id: post.id, ...(expected ? {updatedAt: expected} : {}), ...(claim ? {slug: null} : {})};
    try {return (await db.post.updateMany({where, data: values})).count;}
    catch (error) {
      // Two posts raced for the same slug: the loser gets a random suffix.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && values.slug)) throw error;
      return (await db.post.updateMany({where, data: {...values, slug: slugBase(title) + '-' + randomSuffix()}})).count;
    }
  };
  let firstPublished = first;
  if (!await write(data, first)) {
    const now = await db.post.findUnique({where: {id: post.id}, select: {updatedAt: true, slug: true}});
    if (!now) throw new ApiError('NOT_FOUND', 404);
    if (expected && now.updatedAt.getTime() !== expected.getTime()) throw new ApiError('STALE_POST', 409);
    // Somebody else published it a moment ago: the address is theirs to set, the rest of this edit still applies.
    const rest = {...data};
    delete rest.slug;
    firstPublished = false;
    if (!now.slug || !await write(rest, false)) throw new ApiError('STALE_POST', 409);
  }
  const saved = await db.post.findUniqueOrThrow({where: {id: post.id}, select: {id: true, slug: true, title: true, excerpt: true, eventId: true,
    publishedAt: true, updatedAt: true, profile: {select: {handle: true}}}});
  for (const step of follow) await step();
  if (!input.autosave) for (const mediaId of unused) await deleteMediaItem(mediaId).catch(() => {});
  return {...saved, firstPublished};
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
/** Posts the user may edit: those of the own profile and of the schools the user manages. Drafts included. */
export const ownPosts = (profileIds: string | string[]) => db.post.findMany({where: {profileId: {in: [profileIds].flat()}}, orderBy: [{updatedAt: 'desc'}], take: 200,
  select: {id: true, slug: true, title: true, excerpt: true, publishedAt: true, hiddenAt: true, updatedAt: true, profileId: true, profile: {select: {handle: true, name: true}}}});
export const editableProfileIds = (user: {profile?: {id: string} | null; schoolIds?: string[]}) => [...new Set([...(user.profile ? [user.profile.id] : []), ...(user.schoolIds || [])])];
