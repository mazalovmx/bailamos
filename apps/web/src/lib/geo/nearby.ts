import {db, Prisma} from '@dance/db';
import {styleFamily} from '../swing';
import {haversine} from './coarsen';
// PostGIS queries over the GiST-indexed `geo` geography columns. Everything user-supplied is a bound parameter.
export type GeoEvent = {
  id: string; slug: string; title: string; kind: string; timezone: string; lat: number; lng: number;
  startsAt: Date; city: string; venue: string | null; styles: string[]; distanceM: number | null;
};
type Filter = {from: Date; to: Date; style?: string[]; limit: number};
type Columns = {geo: Prisma.Sql; lat: Prisma.Sql; lng: Prisma.Sql};
const point = (lat: number, lng: number) => Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
const eventColumns: Columns = {geo: Prisma.sql`e.geo`, lat: Prisma.sql`e.lat`, lng: Prisma.sql`e.lng`};
const venueColumns: Columns = {geo: Prisma.sql`v.geo`, lat: Prisma.sql`v.lat`, lng: Prisma.sql`v.lng`};
// Published, visible events with at least one upcoming non-cancelled occurrence in the window, one row per event.
// An event without its own coordinates is placed at its venue.
function eventsQuery(within: (columns: Columns) => Prisma.Sql, distance: Prisma.Sql, order: Prisma.Sql, {from, to, style = [], limit}: Filter) {
  // Style filter includes descendants: the hard-coded swing families plus the DanceStyle tree.
  const roots = [...new Set(style.flatMap(styleFamily))];
  const styleFilter = roots.length ? Prisma.sql`AND EXISTS (SELECT 1 FROM "EventStyle" es WHERE es."eventId" = c.id AND es."styleId" IN (SELECT id FROM family))` : Prisma.empty;
  return db.$queryRaw<GeoEvent[]>`
    WITH RECURSIVE family AS (
      SELECT id FROM "DanceStyle" WHERE id = ANY(${roots}::text[])
      UNION SELECT s.id FROM "DanceStyle" s JOIN family f ON s."parentId" = f.id
    ), c AS (
      SELECT e.id, e.slug, e.title, e.kind::text AS kind, e.timezone, e."cityId", e."venueId", e.lat, e.lng, e.geo
      FROM "Event" e
      WHERE e.status = 'PUBLISHED' AND e."hiddenAt" IS NULL AND ${within(eventColumns)}
      UNION ALL
      SELECT e.id, e.slug, e.title, e.kind::text AS kind, e.timezone, e."cityId", e."venueId", v.lat, v.lng, v.geo
      FROM "Venue" v JOIN "Event" e ON e."venueId" = v.id
      WHERE e.geo IS NULL AND e.status = 'PUBLISHED' AND e."hiddenAt" IS NULL AND v."hiddenAt" IS NULL AND ${within(venueColumns)}
    ), hit AS (
      SELECT c.*, o."startsAt", ${distance} AS "distanceM"
      FROM c JOIN LATERAL (
        SELECT o."startsAt" FROM "EventOccurrence" o
        WHERE o."eventId" = c.id AND NOT o.cancelled AND o."startsAt" >= ${from}::timestamptz AND o."startsAt" < ${to}::timestamptz
        ORDER BY o."startsAt" LIMIT 1
      ) o ON true
      WHERE true ${styleFilter}
      ORDER BY ${order} LIMIT ${limit}::int
    )
    SELECT h.id, h.slug, h.title, h.kind, h.timezone, h.lat, h.lng, h."startsAt", h."distanceM", ci.name AS city, v.name AS venue,
      COALESCE((SELECT array_agg(s.name ORDER BY s.name) FROM "EventStyle" es JOIN "DanceStyle" s ON s.id = es."styleId" WHERE es."eventId" = h.id), '{}') AS styles
    FROM hit h JOIN "City" ci ON ci.id = h."cityId" LEFT JOIN "Venue" v ON v.id = h."venueId" AND v."hiddenAt" IS NULL
    ORDER BY ${order}`;
}
export function nearbyEvents({lat, lng, radiusKm, ...filter}: {lat: number; lng: number; radiusKm: number} & Filter): Promise<GeoEvent[]> {
  const centre = point(lat, lng), metres = radiusKm * 1000;
  return eventsQuery(columns => Prisma.sql`ST_DWithin(${columns.geo}, ${centre}, ${metres}::float8)`,
    Prisma.sql`ST_Distance(c.geo, ${centre})`, Prisma.sql`"distanceM", "startsAt", id`, filter);
}
// Map viewport. bbox = [west, south, east, north]; west > east means the box crosses the antimeridian.
export function bboxEvents({bbox: [west, south, east, north], ...filter}: {bbox: [number, number, number, number]} & Filter): Promise<GeoEvent[]> {
  const span = west <= east ? east - west : east - west + 360;
  const centre = {lat: (south + north) / 2, lng: ((west + span / 2 + 540) % 360) - 180};
  // The circle around the box lets the GiST index prune; the exact rectangle is then checked on lat/lng.
  // Near-global views skip the circle: it would cover most of the planet anyway.
  const radius = Math.max(haversine(centre, {lat: south, lng: west}), haversine(centre, {lat: north, lng: west})) * 1.01 + 100;
  const circle = span < 60 && radius < 3000000;
  return eventsQuery(columns => Prisma.sql`${circle ? Prisma.sql`ST_DWithin(${columns.geo}, ${point(centre.lat, centre.lng)}, ${radius}::float8) AND` : Prisma.empty}
      ${columns.lat} BETWEEN ${south}::float8 AND ${north}::float8 AND ${west <= east
        ? Prisma.sql`${columns.lng} BETWEEN ${west}::float8 AND ${east}::float8`
        : Prisma.sql`(${columns.lng} >= ${west}::float8 OR ${columns.lng} <= ${east}::float8)`}`,
    Prisma.sql`NULL::float8`, Prisma.sql`"startsAt", id`, filter);
}
export type NearCity = {id: string; slug: string; name: string; countryCode: string; lat: number; lng: number; distanceM: number};
// Nearest seeded city by index-assisted KNN.
export async function nearestCity(lat: number, lng: number): Promise<NearCity | null> {
  const centre = point(lat, lng);
  const rows = await db.$queryRaw<NearCity[]>`
    SELECT id, slug, name, "countryCode", lat, lng, ST_Distance(geo, ${centre}) AS "distanceM"
    FROM "City" WHERE geo IS NOT NULL ORDER BY geo <-> ${centre} LIMIT 1`;
  return rows[0] || null;
}
// Plain JSON shape shared by both event endpoints.
export function serializeEvents(events: GeoEvent[]) {
  return events.map(event => ({...event, startsAt: event.startsAt.toISOString(), distanceM: event.distanceM === null ? null : Math.round(event.distanceM)}));
}
