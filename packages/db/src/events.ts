import {randomBytes} from 'node:crypto';
import type {Event, EventStatus, Prisma} from '@prisma/client';

export class EventConflict extends Error {
  constructor(public code: string, public status = 409) {super(code);}
}
export const eventShortCode = () => [...randomBytes(8)].map(byte => 'abcdefghijklmnopqrstuvwxyz234567'[byte & 31]).join('');
export async function lockEvent(tx: Prisma.TransactionClient, id: string, version?: number) {
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${id} FOR UPDATE`;
  const event = await tx.event.findUnique({where: {id}});
  if (!event) throw new EventConflict('NOT_FOUND', 404);
  if (version !== undefined && event.version !== version) throw new EventConflict('EVENT_CONFLICT');
  return event;
}

type Notice = {type: 'EVENT_CANCELLED' | 'EVENT_MOVED' | 'EVENT_REMINDER'; key: string; exceptUserId?: string;
  occurrence?: {id: string; startsAt: Date}; previous?: Date; previousPlace?: string; link?: boolean};
// Resolve recipients and persist the in-app notice and delivery intent inside the caller's transaction.
export async function queueEventNotice(tx: Prisma.TransactionClient, event: Event, notice: Notice) {
  const positive = new Set(['GOING','INTERESTED']);
  const answers = await tx.rsvp.findMany({where: {eventId: event.id}});
  const effective = new Map(answers.map(row => [row.profileId, row.status]));
  if (notice.occurrence) {
    const overrides = await tx.occurrenceRsvp.findMany({where: {occurrenceId: notice.occurrence.id}});
    for (const row of overrides) effective.set(row.profileId, row.status);
  } else {
    const dates = await tx.occurrenceRsvp.findMany({where: {occurrence: {eventId: event.id, startsAt: {gte: new Date()}}, status: {in: ['GOING','INTERESTED']}}});
    for (const row of dates) effective.set(row.profileId, row.status);
  }
  const ids = [...effective].filter(([,answer]) => notice.type === 'EVENT_REMINDER' ? answer === 'GOING' : positive.has(answer)).map(([id]) => id);
  const users = await tx.user.findMany({where: {profile: {id: {in: ids}}, bannedAt: null, ...(notice.exceptUserId ? {id: {not: notice.exceptUserId}} : {})}, select: {id: true, locale: true}});
  const venue = event.venueId ? await tx.venue.findUnique({where: {id: event.venueId}}) : null;
  const city = await tx.city.findUnique({where: {id: event.cityId}});
  const place = [venue && !venue.hiddenAt ? venue.name : null, venue && !venue.hiddenAt ? venue.address : event.address, city?.name].filter(Boolean).join(', ');
  const data = {eventId: event.id, slug: event.slug, title: event.title, timezone: event.timezone,
    startsAt: (notice.occurrence?.startsAt || event.startsAt).toISOString(), place,
    ...(event.lat != null && event.lng != null ? {mapUrl: `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}`} : {}),
    ...(notice.occurrence ? {occurrenceId: notice.occurrence.id, date: notice.occurrence.startsAt.toISOString()} : {}),
    ...(notice.previous ? {previous: notice.previous.toISOString()} : {}),
    ...(notice.previousPlace ? {previousPlace: notice.previousPlace} : {})};
  for (const user of users) {
    const locale = ['en','es','ru'].includes(user.locale) ? user.locale : 'en';
    const url = notice.link === false ? null : '/' + locale + '/events/' + event.slug + (notice.occurrence ? '?date=' + encodeURIComponent(notice.occurrence.startsAt.toISOString()) : '');
    const dedupeKey = notice.key + ':' + user.id;
    await tx.notification.createMany({data: [{userId: user.id, type: notice.type, data, url, dedupeKey}], skipDuplicates: true});
    await tx.eventDelivery.upsert({where: {dedupeKey}, create: {dedupeKey, userId: user.id, type: notice.type, data, url}, update: {}});
  }
  return users.length;
}

// All publishing entrypoints share this rule; cancelling an event never rewrites per-date exceptions.
export async function changeEventStatus(tx: Prisma.TransactionClient, id: string, status: EventStatus, actorId: string, version?: number) {
  const before = await lockEvent(tx, id, version);
  if (before.status === status) return before;
  if (status === 'PUBLISHED' && !before.placeConfirmed) throw new EventConflict('PLACE_REQUIRED', 400);
  const event = await tx.event.update({where: {id}, data: {status, version: {increment: 1},
    ...(status === 'PUBLISHED' && !before.shortCode ? {shortCode: eventShortCode()} : {})}});
  if (before.status === 'PUBLISHED' && (status === 'CANCELLED' || status === 'DRAFT')) {
    await queueEventNotice(tx, event, {type: 'EVENT_CANCELLED', key: `event:${id}:${event.version}:cancel`, exceptUserId: actorId, link: status !== 'DRAFT'});
  }
  return event;
}
