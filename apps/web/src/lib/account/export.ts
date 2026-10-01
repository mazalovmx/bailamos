import {db} from '@dance/db';
import {chatExport} from '../chat/export';
// Everything the platform stores about one account, for the "download my data" request.
// Secrets (password hashes, OAuth and session tokens, push keys and full push endpoints, the Telegram chat id) are deliberately left out,
// and so is anything other people wrote: only the user's own chat messages are included.
const host = (endpoint: string) => {try {return new URL(endpoint).host;} catch {return 'unknown';}};
export async function exportUserData(userId: string) {
  const user = await db.user.findUnique({where: {id: userId}, select: {
    id: true, name: true, email: true, emailVerified: true, image: true, ageConfirmed: true, locale: true, role: true,
    bannedAt: true, banReason: true, createdAt: true, updatedAt: true}});
  if (!user) return null;
  const profile = await db.profile.findUnique({where: {userId}, select: {
    id: true, type: true, handle: true, name: true, bio: true, instagram: true, avatarKey: true, coverKey: true,
    cityId: true, district: true, lat: true, lng: true, hiddenAt: true, lastActiveAt: true, createdAt: true, updatedAt: true}});
  const pid = profile?.id ?? '';
  const [accounts, sessions, consents, follows, notifications, notificationPreference, push, claims, reports, telegram, schoolGrants, chat,
    skills, eventMemberships, rsvps, occurrenceRsvps, posts, media, partnerInterestsSent, partnerInterestsReceived] = await Promise.all([
    db.account.findMany({where: {userId}, select: {providerId: true, createdAt: true}}),
    db.session.findMany({where: {userId}, select: {createdAt: true, expiresAt: true, ipAddress: true, userAgent: true}}),
    db.consentLog.findMany({where: {userId}, orderBy: {createdAt: 'asc'}, select: {kind: true, granted: true, version: true, createdAt: true}}),
    db.follow.findMany({where: {userId}, select: {cityId: true, styleId: true, profileId: true, createdAt: true}}),
    db.notification.findMany({where: {userId}, orderBy: {createdAt: 'asc'}, select: {type: true, data: true, url: true, readAt: true, createdAt: true}}),
    db.notificationPreference.findUnique({where: {userId}, select: {pushReminders: true, pushRsvp: true, pushChat: true, emailEvents: true, emailDigest: true}}),
    db.pushSubscription.findMany({where: {userId}, select: {endpoint: true, createdAt: true}}),
    db.profileClaim.findMany({where: {userId}, select: {profileId: true, message: true, status: true, decidedAt: true, createdAt: true}}),
    db.report.findMany({where: {reporterUserId: userId}, select: {targetType: true, targetId: true, reason: true, comment: true, status: true, createdAt: true}}),
    db.telegramChat.findUnique({where: {userId}, select: {cityId: true, locale: true, notify: true, createdAt: true}}),
    db.schoolAdmin.findMany({where: {userId}, orderBy: {createdAt: 'asc'}, select: {schoolProfileId: true, createdAt: true, school: {select: {handle: true, name: true}}}}),
    chatExport(userId),
    db.danceSkill.findMany({where: {profileId: pid}, select: {styleId: true, role: true, level: true, lookingFor: true}}),
    db.eventMembership.findMany({where: {profileId: pid}, select: {eventId: true, role: true, event: {select: {slug: true, title: true}}}}),
    db.rsvp.findMany({where: {profileId: pid}, select: {eventId: true, status: true, createdAt: true, event: {select: {slug: true, title: true}}}}),
    db.occurrenceRsvp.findMany({where: {profileId: pid}, orderBy: {createdAt: 'asc'}, select: {occurrenceId: true, status: true, createdAt: true,
      occurrence: {select: {startsAt: true, eventId: true, event: {select: {slug: true, title: true}}}}}}),
    db.post.findMany({where: {profileId: pid}, select: {id: true, slug: true, title: true, excerpt: true, content: true, eventId: true,
      publishedAt: true, hiddenAt: true, createdAt: true, updatedAt: true}}),
    db.mediaItem.findMany({where: {uploaderProfileId: pid}, select: {id: true, postId: true, eventId: true, kind: true, storageKey: true,
      mime: true, size: true, width: true, height: true, alt: true, sourceUrl: true, hiddenAt: true, createdAt: true}}),
    db.partnerInterest.findMany({where: {fromProfileId: pid}, select: {toProfileId: true, styleId: true, createdAt: true}}),
    db.partnerInterest.findMany({where: {toProfileId: pid}, select: {fromProfileId: true, styleId: true, createdAt: true}})
  ]);
  return {exportedAt: new Date().toISOString(), formatVersion: 2, user, signInMethods: accounts, sessions, consents, profile, skills,
    eventMemberships, rsvps,
    occurrenceRsvps: occurrenceRsvps.map(({occurrence, ...rsvp}) => ({...rsvp, startsAt: occurrence.startsAt, eventId: occurrence.eventId, event: occurrence.event})),
    posts, media, follows, notifications, notificationPreference,
    pushSubscriptions: push.map(subscription => ({endpointHost: host(subscription.endpoint), createdAt: subscription.createdAt})),
    messages: chat.messages, conversations: chat.conversations, blocks: chat.blocks, partnerInterestsSent, partnerInterestsReceived,
    schoolGrants: schoolGrants.map(({school, ...grant}) => ({...grant, ...school})), profileClaims: claims, reports,
    telegram: telegram ? {linked: true, notify: telegram.notify, locale: telegram.locale, cityId: telegram.cityId, linkedAt: telegram.createdAt} : {linked: false}};
}
export type AccountExport = NonNullable<Awaited<ReturnType<typeof exportUserData>>>;
