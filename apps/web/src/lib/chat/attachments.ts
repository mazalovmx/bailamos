import {db} from '@dance/db';
import {storage} from '../storage';
import {WIDTHS, chatPrefix, parseChatKey, variantKeys, type Format} from '../media/keys';
import type {ChatAttachment} from './types';
// Stored objects of chat attachments. They live under "chat/<conversationId>/<uploaderProfileId>/<uuid>/", a prefix the public
// media route does not recognise; the only way to read one is /api/chat/attachments/<messageId>.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export function attachmentUrls(messageId: string): ChatAttachment {
  const url = (width: number, format: Format) => '/api/chat/attachments/' + messageId + '?w=' + width + '&f=' + format;
  const srcset = (format: Format) => WIDTHS.map(width => url(width, format) + ' ' + width + 'w').join(', ');
  return {src: url(800, 'webp'), avif: srcset('avif'), webp: srcset('webp')};
}
/** Removes the files behind the given attachment keys; anything that is not a chat key is ignored. */
export async function deleteAttachmentObjects(keys: (string | null | undefined)[]) {
  const objects = keys.flatMap(key => key && parseChatKey(key) ? variantKeys(key) : []);
  if (objects.length) await storage().deleteObjects(objects);
}
/** Call when a conversation is removed (its Message rows go by cascade): deletes every attachment ever uploaded to it. */
export async function deleteConversationAttachments(conversationId: string) {
  if (!ID.test(conversationId)) throw new Error('INVALID_CONVERSATION_ID');
  await storage().deletePrefix(chatPrefix(conversationId));
}
/**
 * Account deletion: removes the files of every attachment the profile sent. Call it while the profile row still exists,
 * before the Message rows disappear by cascade. Storage errors propagate so the caller can report an incomplete cleanup.
 */
export async function deleteProfileChatAttachments(profileId: string) {
  if (!ID.test(profileId)) throw new Error('INVALID_PROFILE_ID');
  const where = {senderProfileId: profileId, attachmentKey: {not: null}};
  const rows = await db.message.findMany({where, select: {attachmentKey: true}});
  await db.message.updateMany({where, data: {attachmentKey: null}});
  await deleteAttachmentObjects(rows.map(row => row.attachmentKey));
  return {attachments: rows.length};
}
