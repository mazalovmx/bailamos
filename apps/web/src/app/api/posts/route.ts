import {actor, ApiError, jsonBody, viewer} from '../../../lib/api';
import {blogFail, limited} from '../../../lib/blog/http';
import {createDraft, createInput, ownPosts, profileIdOf} from '../../../lib/blog/posts';
// GET /api/posts — the signed-in author's own posts, drafts included.
export async function GET(request: Request) {
  try {
    const user = await viewer(request);
    if (!user) throw new ApiError('UNAUTHORIZED', 401);
    return Response.json({posts: user.profile ? await ownPosts(user.profile.id) : []}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return blogFail(error);}
}
// POST /api/posts {title?} — starts a draft. Photos need a post to belong to, so the draft exists before the first upload.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const profileId = profileIdOf(user);
    const {title} = createInput.parse(await jsonBody(request));
    await limited('post-create:' + user.id, {limit: 30, windowSec: 3600});
    return Response.json(await createDraft(profileId, title), {status: 201});
  } catch (error) {return blogFail(error);}
}
