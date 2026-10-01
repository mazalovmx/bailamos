import {AbilityBuilder, createMongoAbility, subject} from '@casl/ability';
type Viewer = {role?: string; profile?: {id: string} | null} | null | undefined;
export type PostFacts = {profileId: string; publishedAt: Date | null; hiddenAt: Date | null};
// Everyone reads published, non-hidden posts. The author alone edits, publishes and deletes; staff may additionally read
// drafts and hidden posts (moderation itself goes through the admin panel, not through these routes).
export function postAbility(viewer: Viewer) {
  const {can, build} = new AbilityBuilder(createMongoAbility);
  can('read', 'Post', {published: true, hidden: false});
  if (viewer?.profile?.id) can(['read', 'update', 'publish', 'delete'], 'Post', {profileId: viewer.profile.id});
  if (viewer?.role === 'OWNER' || viewer?.role === 'ADMIN' || viewer?.role === 'MODERATOR') can('read', 'Post');
  return build();
}
export type PostAction = 'read' | 'update' | 'publish' | 'delete';
export const canPost = (viewer: Viewer, action: PostAction, post: PostFacts) =>
  postAbility(viewer).can(action, subject('Post', {profileId: post.profileId, published: !!post.publishedAt, hidden: !!post.hiddenAt}));
