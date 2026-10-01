import {db, type Prisma} from '@dance/db';
import {profileJsonLd} from '../account/jsonld';
import {HOST_ROLES, REGULAR_KINDS} from './timetable';
// Profile types that run a timetable and therefore have a page under /schools/<handle>.
export const TIMETABLE_TYPES = ['SCHOOL', 'VENUE', 'ORGANIZER'] as const;
export const hasTimetable = (type: string) => (TIMETABLE_TYPES as readonly string[]).includes(type);
export const MAX_SCHOOLS = 200;
/** Directory of schools, optionally for one city. Unclaimed stubs (no owner yet) are included and marked. */
export async function listSchools(cityId?: string | null, now = new Date()) {
  const rows = await db.profile.findMany({where: {type: 'SCHOOL', hiddenAt: null, ...(cityId ? {cityId} : {})}, orderBy: [{name: 'asc'}, {id: 'asc'}], take: MAX_SCHOOLS + 1,
    select: {id: true, handle: true, name: true, userId: true, district: true, avatarKey: true, city: {select: {slug: true, name: true}}}});
  const page = rows.slice(0, MAX_SCHOOLS);
  // Distinct events, not membership rows: a school can be both owner and artist of the same class.
  const hosting = await db.eventMembership.findMany({distinct: ['profileId', 'eventId'], select: {profileId: true},
    where: {profileId: {in: page.map(school => school.id)}, role: {in: [...HOST_ROLES]}, event: {status: 'PUBLISHED', hiddenAt: null, rrule: {not: null}, kind: {in: [...REGULAR_KINDS]},
      occurrences: {some: {cancelled: false, startsAt: {gte: now}}}}}});
  const classes = new Map<string, number>();
  for (const row of hosting) classes.set(row.profileId, (classes.get(row.profileId) || 0) + 1);
  return {truncated: rows.length > MAX_SCHOOLS, schools: page.map(({userId, ...school}) => ({...school, unclaimed: userId === null, classes: classes.get(school.id) || 0}))};
}
export type SchoolCard = Awaited<ReturnType<typeof listSchools>>['schools'][number];
// Public fields only: coordinates and the owner's email are never selected. Moderated profiles do not exist publicly.
export function findSchool(handle: string) {
  return db.profile.findFirst({where: {handle: handle.toLowerCase(), hiddenAt: null, type: {in: [...TIMETABLE_TYPES]}}, select: {
    id: true, userId: true, name: true, handle: true, type: true, bio: true, instagram: true, avatarKey: true, coverKey: true, district: true,
    city: {select: {slug: true, name: true, countryCode: true, timezone: true}}, _count: {select: {followers: true}}}});
}
export type School = NonNullable<Awaited<ReturnType<typeof findSchool>>>;
const hosted = (profileId: string): Prisma.EventWhereInput => ({status: 'PUBLISHED', hiddenAt: null, members: {some: {profileId, role: {in: [...HOST_ROLES]}}}});
/** Everything ahead that is not part of the weekly timetable: workshops, intensives, parties, one-off classes. */
export async function upcomingSpecials(profileId: string, now = new Date(), take = 12) {
  const rows = await db.eventOccurrence.findMany({
    where: {cancelled: false, startsAt: {gte: now}, event: {...hosted(profileId), NOT: {rrule: {not: null}, kind: {in: [...REGULAR_KINDS]}}}},
    orderBy: [{startsAt: 'asc'}, {id: 'asc'}], take: take * 6,
    select: {startsAt: true, event: {select: {id: true, slug: true, title: true, kind: true, level: true, priceText: true, timezone: true,
      city: {select: {name: true}}, venue: {select: {name: true, hiddenAt: true}}}}}});
  // One line per event, at its next date.
  const seen = new Set<string>();
  return rows.filter(row => !seen.has(row.event.id) && !!seen.add(row.event.id)).slice(0, take).map(({startsAt, event: {venue, ...event}}) =>
    ({...event, startsAt, venue: venue && !venue.hiddenAt ? venue.name : null}));
}
/** Places where the school currently teaches or hosts something. */
export async function schoolVenues(profileId: string, now = new Date()) {
  return db.venue.findMany({where: {hiddenAt: null, events: {some: {...hosted(profileId), occurrences: {some: {cancelled: false, startsAt: {gte: now}}}}}},
    orderBy: {name: 'asc'}, take: 12, select: {id: true, name: true, address: true, lat: true, lng: true, city: {select: {name: true, countryCode: true}}}});
}
export type SchoolVenue = Awaited<ReturnType<typeof schoolVenues>>[number];
/** Schema.org DanceSchool (Organization / Place for the other types). Venue coordinates are public; the profile's own never are. */
export function schoolJsonLd(school: School, venues: SchoolVenue[], origin: string, url: string) {
  return {...profileJsonLd(school, origin), url, sameAs: [origin + '/@' + school.handle, ...(school.instagram ? ['https://www.instagram.com/' + school.instagram + '/'] : [])],
    ...(venues.length ? {location: venues.map(venue => ({'@type': 'Place', name: venue.name, url: origin + '/venues/' + venue.id,
      address: {'@type': 'PostalAddress', streetAddress: venue.address, addressLocality: venue.city.name, addressCountry: venue.city.countryCode.trim()},
      geo: {'@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng}}))} : {})};
}
