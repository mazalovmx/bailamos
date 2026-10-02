import {db} from '@dance/db';
// Stored files are removed first, while the rows that name them still exist. The media feature owns lib/media/cleanup.ts;
// if storage is down, deletion of the account still proceeds and the failure is logged.
async function removeMedia(profileId: string) {
  try {
    const {deleteProfileMedia} = await import('../media/cleanup');
    await deleteProfileMedia(profileId);
    const {deleteProfileChatAttachments} = await import('../chat/attachments');
    await deleteProfileChatAttachments(profileId);
    return true;
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'media_cleanup_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return false;
  }
}
/**
 * Removes the account in one transaction. Foreign-key cascades take the sessions, sign-in methods, consents, notifications,
 * push subscriptions, follows, claims and school grants of the user, and with the profile its skills, RSVPs (series-wide and
 * per-date), event memberships, posts, partner interests, blocks in both directions, chat memberships and messages.
 * What the cascades do not reach is handled here:
 * - direct conversations of the profile, which would otherwise stay behind as one-sided orphans holding its `directKey`;
 * - group conversations left without a single member;
 * - pending event invitations sent by or addressed to the account;
 * - the Telegram chat binding (its foreign key only detaches the row, and the bot would keep writing to that chat);
 * - one-time tokens issued for the address.
 * Reports the user filed stay for moderators with the reporter detached (`reporterUserId` becomes NULL).
 */
export async function deleteAccount(userId: string) {
  const user = await db.user.findUnique({where: {id: userId}, select: {email: true, profile: {select: {id: true}}}});
  if (!user) return {mediaRemoved: true};
  const pid = user.profile?.id;
  const mediaRemoved = pid ? await removeMedia(pid) : true;
  await db.$transaction(async tx => {
    // Before the user row goes: afterwards the binding would only be detached and no longer be findable.
    await tx.telegramChat.deleteMany({where: {userId}});
    if (pid) {
      const groups = (await tx.conversationMember.findMany({where: {profileId: pid, conversation: {kind: 'GROUP'}}, select: {conversationId: true}})).map(m => m.conversationId);
      await tx.conversation.deleteMany({where: {kind: 'DIRECT', OR: [{directKey: {startsWith: pid + ':'}}, {directKey: {endsWith: ':' + pid}}]}});
      await tx.eventInvite.deleteMany({where: {acceptedAt: null, OR: [{profileId: pid}, {invitedByProfileId: pid}, {email: {equals: user.email, mode: 'insensitive'}}]}});
      await tx.user.delete({where: {id: userId}});
      if (groups.length) await tx.conversation.deleteMany({where: {id: {in: groups}, kind: 'GROUP', members: {none: {}}}});
    } else {
      await tx.eventInvite.deleteMany({where: {acceptedAt: null, email: {equals: user.email, mode: 'insensitive'}}});
      await tx.user.delete({where: {id: userId}});
    }
    await tx.verification.deleteMany({where: {OR: [{identifier: user.email}, {value: userId}]}});
  });
  return {mediaRemoved};
}
