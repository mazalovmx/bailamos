import {actor, ApiError, jsonBody, viewer} from '../../../lib/api';
import {blogFail, limited} from '../../../lib/blog/http';
import {createDraft, createInput, editableProfileIds, ownPosts, publisherFor} from '../../../lib/blog/posts';
// GET /api/posts — the signed-in author's own posts and those of the schools they manage, drafts included.
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    const profileIds = editableProfileIds(user);
    return Response.json({posts: profileIds.length ? await ownPosts(profileIds) : []}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return blogFail(error);}
}
// POST /api/posts {title?, profileId?} — starts a draft. Photos need a post to belong to, so the draft exists before the first upload.
// `profileId` publishes in the name of a school the author manages; without it the post is the author's own.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const {title, profileId} = createInput.parse(await jsonBody(request));
    const publisher = await publisherFor(user, profileId);
    await limited('post-create:' + user.id, {limit: 30, windowSec: 3600});
    return Response.json(await createDraft(publisher.profileId, title, publisher.schoolProfileId), {status: 201});
  } catch (error) {return blogFail(error);}
}
