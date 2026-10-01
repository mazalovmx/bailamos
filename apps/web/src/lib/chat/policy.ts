import {db, Prisma} from '@dance/db';
type Client = Prisma.TransactionClient;
// How many messages a stranger may send before the recipient accepts the request.
export function requestMessageLimit() {
  const value = Number(process.env.CHAT_REQUEST_MESSAGE_LIMIT);
  return Number.isInteger(value) && value > 0 && value <= 50 ? value : 3;
}
export const limits = {
  bodyMax: 2000, titleMax: 80, groupMembers: 50, pageSize: 30, pageMax: 100,
  send: {limit: 20, windowSec: 60},
  // Messages that land in somebody's requests are limited much harder than ordinary conversation.
  requestSend: {limit: 10, windowSec: 3600},
  newDirect: {limit: 20, windowSec: 3600},
  newGroup: {limit: 5, windowSec: 3600},
  invite: {limit: 30, windowSec: 3600},
  stream: {limit: 30, windowSec: 60}
} as const;
export const directKey = (a: string, b: string) => [a, b].sort().join(':');
export const directPeer = (key: string, profileId: string) => key.split(':').find(id => id !== profileId) ?? null;
/** True when either profile has blocked the other. Callers must not tell the user which direction it is. */
export async function isBlockedBetween(a: string, b: string, client: Client = db) {
  if (!a || !b || a === b) return false;
  return !!await client.block.findFirst({where: {OR: [{blockerProfileId: a, blockedProfileId: b}, {blockerProfileId: b, blockedProfileId: a}]},
    select: {blockerProfileId: true}});
}
/**
 * "Not a stranger": the recipient follows the sender's profile, or both sent each other a PartnerInterest, or they already
 * share a conversation both have accepted. Public rooms (event, city) do not count: anyone can join those.
 */
export async function isKnownTo(senderProfileId: string, recipientProfileId: string, client: Client = db) {
  if (senderProfileId === recipientProfileId) return true;
  const [follow, interests, shared] = await Promise.all([
    client.follow.findFirst({where: {profileId: senderProfileId, user: {profile: {id: recipientProfileId}}}, select: {id: true}}),
    client.partnerInterest.count({where: {OR: [{fromProfileId: senderProfileId, toProfileId: recipientProfileId},
      {fromProfileId: recipientProfileId, toProfileId: senderProfileId}]}}),
    client.conversation.findFirst({where: {kind: {in: ['DIRECT', 'GROUP']}, AND: [
      {members: {some: {profileId: senderProfileId, accepted: true}}}, {members: {some: {profileId: recipientProfileId, accepted: true}}}]}, select: {id: true}})
  ]);
  return !!follow || interests === 2 || !!shared;
}
/** Pure rule for a pending request: how many more messages the sender may still send. */
export const requestRemaining = (sent: number, limit = requestMessageLimit()) => Math.max(0, limit - sent);
