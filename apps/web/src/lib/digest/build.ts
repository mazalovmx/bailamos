import {cityLabeler} from '../catalogue/data';
import {db, type Prisma} from '@dance/db';
import {DateTime} from 'luxon';
import {descendantIds, type StyleNode} from '../catalogue/tree';
// Weekly digest (F15): "what is on this week" for the cities, styles and profiles a person follows.
export const DIGEST_DAYS = 7, DIGEST_CAP = 20, DIGEST_SCAN = 400;
export type DigestReason = 'city' | 'style' | 'profile';
export type DigestEvent = {eventId: string; slug: string; title: string; kind: string; level: string; priceText: string | null;
  startsAt: Date; timezone: string; date: string; city: string; venue: string | null; extraDates: number; reasons: DigestReason[]};
export type Digest = {userId: string; email: string; locale: string; name: string;
  /** The single followed city, for the subject line; null when there are none or several. */
  place: string | null;
  days: {date: string; events: DigestEvent[]}[]; shown: number; more: number};
export type DigestRow = {startsAt: Date; event: {id: string; slug: string; title: string; kind: string; level: string; priceText: string | null; timezone: string;
  cityId: string; city: {name: string}; venue: {name: string; hiddenAt: Date | null} | null; styles: {styleId: string}[]; members: {profileId: string}[]}};
const HOSTS = ['OWNER', 'CO_ORGANIZER', 'ARTIST'] as const;
const localDate = (date: Date, zone: string) => {
  const local = DateTime.fromJSDate(date, {zone});
  return (local.isValid ? local : DateTime.fromJSDate(date, {zone: 'UTC'})).toISODate()!;
};
/**
 * Pure selection step, separated for tests. `rows` are occurrences ordered by start. One line per event (its first date in
 * the window; further dates are counted), each tagged with why it matched. When more events match than fit, the ones that
 * match several subscriptions win, then the earliest; the result is shown chronologically, grouped by the event's own local day.
 */
export function selectDigestEvents(rows: DigestRow[], follows: {cityIds: string[]; styleIds: string[]; profileIds: string[]}, cap = DIGEST_CAP, cityLabel: (name: string) => string = name => name) {
  const cities = new Set(follows.cityIds), styles = new Set(follows.styleIds), profiles = new Set(follows.profileIds);
  const events = new Map<string, DigestEvent>();
  for (const {startsAt, event} of rows) {
    const known = events.get(event.id);
    if (known) {known.extraDates++; continue;}
    const reasons: DigestReason[] = [...(cities.has(event.cityId) ? ['city' as const] : []), ...(event.styles.some(item => styles.has(item.styleId)) ? ['style' as const] : []),
      ...(event.members.some(member => profiles.has(member.profileId)) ? ['profile' as const] : [])];
    if (!reasons.length) continue;
    events.set(event.id, {eventId: event.id, slug: event.slug, title: event.title, kind: event.kind, level: event.level, priceText: event.priceText, startsAt, timezone: event.timezone,
      date: localDate(startsAt, event.timezone), city: cityLabel(event.city.name), venue: event.venue && !event.venue.hiddenAt ? event.venue.name : null, extraDates: 0, reasons});
  }
  const all = [...events.values()];
  const chosen = all.length <= cap ? all : [...all].sort((a, b) => b.reasons.length - a.reasons.length || a.startsAt.getTime() - b.startsAt.getTime()).slice(0, cap);
  chosen.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title));
  const days: Digest['days'] = [];
  for (const event of chosen) {
    if (days.at(-1)?.date !== event.date) days.push({date: event.date, events: []});
    days.at(-1)!.events.push(event);
  }
  return {days, shown: chosen.length, more: all.length - chosen.length};
}
/**
 * The digest of one account for the 7 days after `now`, or null when there is nothing to send: the digest is off,
 * the address is unverified, the account is banned, nothing is followed or nothing is happening.
 */
export async function buildDigest(userId: string, now = new Date(), styleTree?: readonly StyleNode[]): Promise<Digest | null> {
  const user = await db.user.findUnique({where: {id: userId}, select: {id: true, email: true, name: true, locale: true, emailVerified: true, bannedAt: true,
    notificationPreference: {select: {emailDigest: true}},
    follows: {select: {cityId: true, styleId: true, profileId: true, city: {select: {name: true}}, profile: {select: {hiddenAt: true}}}}}});
  if (!user || user.bannedAt || !user.emailVerified || !user.notificationPreference?.emailDigest) return null;
  const cityIds = user.follows.flatMap(row => row.cityId ? [row.cityId] : []);
  const profileIds = user.follows.flatMap(row => row.profileId && !row.profile?.hiddenAt ? [row.profileId] : []);
  const followedStyles = user.follows.flatMap(row => row.styleId ? [row.styleId] : []);
  if (!cityIds.length && !profileIds.length && !followedStyles.length) return null;
  // Following "swing" includes Lindy Hop: a style subscription covers its whole branch.
  const tree = followedStyles.length ? styleTree ?? await db.danceStyle.findMany({select: {id: true, slug: true, name: true, parentId: true}}) : [];
  const styleIds = [...new Set(followedStyles.flatMap(id => descendantIds(tree, id)))];
  const matches: Prisma.EventWhereInput[] = [...(cityIds.length ? [{cityId: {in: cityIds}}] : []), ...(styleIds.length ? [{styles: {some: {styleId: {in: styleIds}}}}] : []),
    ...(profileIds.length ? [{members: {some: {profileId: {in: profileIds}, role: {in: [...HOSTS]}}}}] : [])];
  const rows = await db.eventOccurrence.findMany({
    where: {cancelled: false, startsAt: {gte: now, lt: new Date(now.getTime() + DIGEST_DAYS * 86400000)}, event: {status: 'PUBLISHED', hiddenAt: null, OR: matches}},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: DIGEST_SCAN,
    select: {startsAt: true, event: {select: {id: true, slug: true, title: true, kind: true, level: true, priceText: true, timezone: true, cityId: true,
      city: {select: {name: true}}, venue: {select: {name: true, hiddenAt: true}}, styles: {select: {styleId: true}},
      members: {where: {role: {in: [...HOSTS]}}, select: {profileId: true}}}}}});
  const label = await cityLabeler(user.locale);
  const selected = selectDigestEvents(rows, {cityIds, styleIds, profileIds}, DIGEST_CAP, label);
  if (!selected.shown) return null;
  const cityNames = user.follows.flatMap(row => row.city ? [label(row.city.name)] : []);
  return {userId: user.id, email: user.email, locale: user.locale, name: user.name, place: cityNames.length === 1 ? cityNames[0] : null, ...selected};
}
