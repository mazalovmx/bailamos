import {db} from '@dance/db';
import {actor, viewer} from '../../../../lib/api';
import {blogFail, limited, postBody} from '../../../../lib/blog/http';
import {patchInput, postFor, removePost, savePost} from '../../../../lib/blog/posts';
import {withoutImages} from '../../../../lib/blog/nodes';
import {notifyNewPost} from '../../../../lib/blog/notify';
import {canPost} from '../../../../lib/blog/permissions';
type Context = {params: Promise<{id: string}>};
// One post. Drafts and hidden posts exist only for their author (and for moderators).
export async function GET(request: Request, {params}: Context) {
  try {
    const {id} = await params, user = await viewer(request);
    const post = await postFor(user, id, 'read');
    const [profile, hidden] = await Promise.all([
      db.profile.findUnique({where: {id: post.profileId}, select: {handle: true, name: true}}),
      db.mediaItem.findMany({where: {postId: post.id, hiddenAt: {not: null}}, select: {id: true}})]);
    const own = canPost(user, 'update', post);
    return Response.json({id: post.id, slug: post.slug, title: post.title, excerpt: post.excerpt,
      content: own ? post.content : withoutImages(post.content, new Set(hidden.map(item => item.id))),
      eventId: post.eventId, publishedAt: post.publishedAt, updatedAt: post.updatedAt,
      author: profile && {handle: profile.handle, name: profile.name}}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return blogFail(error);}
}
// PATCH {title?, content?, eventId?, published?, updatedAt?, autosave?} — saves and/or publishes or unpublishes, in one request.
// `updatedAt` is the version the editor holds: an older one is refused with 409 STALE_POST. `autosave: true` is the
// editor's background save; it is accepted for drafts only (409 AUTOSAVE_PUBLISHED otherwise) and has its own limit.
// A page that is closing sends the same request with fetch keepalive.
export async function PATCH(request: Request, {params}: Context) {
  try {
    const {id} = await params, user = await actor(request);
    const input = patchInput.parse(await postBody(request));
    const post = await postFor(user, id, input.published === undefined ? 'update' : 'publish');
    await limited((input.autosave ? 'post-autosave:' : 'post-save:') + user.id, {limit: input.autosave ? 180 : 120, windowSec: 600});
    const {firstPublished, ...saved} = await savePost(post, input, {actorProfileId: user.profile?.id});
    // Followers hear about a post once, when it first goes public. Not awaited: the author does not wait for the fan-out.
    if (firstPublished) void notifyNewPost(saved.id, {excludeUserIds: [user.id]}).catch(error =>
      console.error(JSON.stringify({level: 'error', event: 'new_post_notify_failed', postId: saved.id, message: error instanceof Error ? error.message : 'unknown'})));
    return Response.json({id: saved.id, slug: saved.slug, handle: saved.profile.handle, title: saved.title, excerpt: saved.excerpt,
      eventId: saved.eventId, publishedAt: saved.publishedAt, updatedAt: saved.updatedAt});
  } catch (error) {return blogFail(error);}
}
// Removes the post for good, together with its photos and embeds.
export async function DELETE(request: Request, {params}: Context) {
  try {
    const {id} = await params, user = await actor(request);
    const post = await postFor(user, id, 'delete');
    await removePost(post.id);
    return Response.json({ok: true});
  } catch (error) {return blogFail(error);}
}
