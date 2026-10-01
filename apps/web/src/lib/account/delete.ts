import {db} from '@dance/db';
// Stored files are removed first, while the rows that name them still exist. The media feature owns lib/media/cleanup.ts;
// if storage is down, deletion of the account still proceeds and the failure is logged.
async function removeMedia(profileId: string) {
  try {
    const {deleteProfileMedia} = await import('../media/cleanup');
    await deleteProfileMedia(profileId);
    return true;
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'media_cleanup_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return false;
  }
}
// Removes the account and, through foreign-key cascades, its sessions, sign-in methods, profile, skills, RSVPs,
// memberships, posts, follows, consents, notifications and messages.
export async function deleteAccount(userId: string) {
  const profile = await db.profile.findUnique({where: {userId}, select: {id: true}});
  const mediaRemoved = profile ? await removeMedia(profile.id) : true;
  await db.user.delete({where: {id: userId}});
  return {mediaRemoved};
}
