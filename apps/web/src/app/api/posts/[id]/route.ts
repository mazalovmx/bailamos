import {db} from '@dance/db';
import {actor, viewer} from '../../../../lib/api';
import {blogFail, limited, postBody} from '../../../../lib/blog/http';
import {patchInput, postFor, removePost, savePost} from '../../../../lib/blog/posts';
import {withoutImages} from '../../../../lib/blog/nodes';
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
// PATCH {title?, content?, eventId?, published?} — saves and/or publishes or unpublishes, in one request.
export async function PATCH(request: Request, {params}: Context) {
  try {
    const {id} = await params, user = await actor(request);
    const input = patchInput.parse(await postBody(request));
    const post = await postFor(user, id, input.published === undefined ? 'update' : 'publish');
    await limited('post-save:' + user.id, {limit: 120, windowSec: 600});
    const saved = await savePost(post, input);
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
