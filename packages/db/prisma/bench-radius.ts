import {db} from '../src/index';
// Radius-search benchmark: 50 000 published events scattered around the seeded city centres, each with one upcoming
// occurrence and one style. Everything is generated inside a transaction that is always rolled back, so no row survives.
// The statement below mirrors apps/web/src/lib/geo/nearby.ts (nearbyEvents); keep the two in step.
// Run: pnpm --filter @dance/db exec dotenv -e ../../.env -- tsx prisma/bench-radius.ts
const EVENTS = 50000, RADIUS_M = 25000, LIMIT = 100, RUNS = 30, TARGET_MS = 100;
const tag = 'bench-' + Date.now().toString(36);
const rollback = new Error('benchmark rollback');
const query = `
  WITH RECURSIVE family AS (
    SELECT id FROM "DanceStyle" WHERE id = ANY($6::text[])
    UNION SELECT s.id FROM "DanceStyle" s JOIN family f ON s."parentId" = f.id
  ), c AS (
    SELECT e.id, e.slug, e.title, e.kind::text AS kind, e.timezone, e."cityId", e."venueId", e.lat, e.lng, e.geo
    FROM "Event" e
    WHERE e.status = 'PUBLISHED' AND e."hiddenAt" IS NULL AND ST_DWithin(e.geo, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography, $3::float8)
    UNION ALL
    SELECT e.id, e.slug, e.title, e.kind::text AS kind, e.timezone, e."cityId", e."venueId", v.lat, v.lng, v.geo
    FROM "Venue" v JOIN "Event" e ON e."venueId" = v.id
    WHERE e.geo IS NULL AND e.status = 'PUBLISHED' AND e."hiddenAt" IS NULL AND v."hiddenAt" IS NULL
      AND ST_DWithin(v.geo, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography, $3::float8)
  ), hit AS (
    SELECT c.*, o."startsAt", ST_Distance(c.geo, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography) AS "distanceM"
    FROM c JOIN LATERAL (
      SELECT o."startsAt" FROM "EventOccurrence" o
      WHERE o."eventId" = c.id AND NOT o.cancelled AND o."startsAt" >= $4::timestamptz AND o."startsAt" < $5::timestamptz
      ORDER BY o."startsAt" LIMIT 1
    ) o ON true
    WHERE (cardinality($6::text[]) = 0 OR EXISTS (SELECT 1 FROM "EventStyle" es WHERE es."eventId" = c.id AND es."styleId" IN (SELECT id FROM family)))
    ORDER BY "distanceM", "startsAt", id LIMIT $7::int
  )
  SELECT h.id, h.slug, h.title, h.kind, h.timezone, h.lat, h.lng, h."startsAt", h."distanceM", ci.name AS city, v.name AS venue,
    COALESCE((SELECT array_agg(s.name ORDER BY s.name) FROM "EventStyle" es JOIN "DanceStyle" s ON s.id = es."styleId" WHERE es."eventId" = h.id), '{}') AS styles
  FROM hit h JOIN "City" ci ON ci.id = h."cityId" LEFT JOIN "Venue" v ON v.id = h."venueId" AND v."hiddenAt" IS NULL
  ORDER BY "distanceM", "startsAt", id`;
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
let failed = false;
try {
  await db.$transaction(async tx => {
    const cities = await tx.city.findMany({select: {name: true, lat: true, lng: true}, orderBy: {slug: 'asc'}});
    if (!cities.length) throw new Error('Seed the cities first: pnpm db:seed');
    const started = performance.now();
    // Events land within roughly 35 km of a pseudo-randomly chosen city centre and start within the next three weeks.
    await tx.$executeRawUnsafe(`
      INSERT INTO "Event" (id, slug, title, "startsAt", timezone, "cityId", lat, lng, status, "updatedAt")
      SELECT $1 || '-' || g, $1 || '-' || g, 'Benchmark event ' || g, now() + (0.1 + random() * 21) * interval '1 day', c.timezone, c.id,
        c.lat + (random() - 0.5) * 0.6, c.lng + (random() - 0.5) * 0.6 / cos(radians(c.lat)), 'PUBLISHED', now()
      FROM generate_series(1, $2::int) g
      JOIN (SELECT id, timezone, lat, lng, row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS n FROM "City") c
        ON c.rn = 1 + (hashint4(g) & 2147483647) % c.n`, tag, EVENTS);
    await tx.$executeRawUnsafe(`INSERT INTO "EventOccurrence" (id, "eventId", "startsAt") SELECT 'o-' || id, id, "startsAt" FROM "Event" WHERE id LIKE $1 || '-%'`, tag);
    await tx.$executeRawUnsafe(`
      INSERT INTO "EventStyle" ("eventId", "styleId")
      SELECT e.id, s.id FROM "Event" e
      JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS n FROM "DanceStyle") s ON s.rn = 1 + (hashtext(e.id) & 2147483647) % s.n
      WHERE e.id LIKE $1 || '-%'`, tag);
    for (const table of ['Event', 'EventOccurrence', 'EventStyle']) await tx.$executeRawUnsafe(`ANALYZE "${table}"`);
    const [{count}] = await tx.$queryRawUnsafe<{count: bigint}[]>(`SELECT count(*) FROM "Event" WHERE id LIKE $1 || '-%'`, tag);
    console.log(`Generated ${count} events around ${cities.length} city centres in ${Math.round(performance.now() - started)} ms (transaction, rolled back at the end).`);
    const from = new Date(), week = new Date(from.getTime() + 7 * 86400000), month = new Date(from.getTime() + 30 * 86400000);
    const cases: [string, Date, string[]][] = [['25 km, next 7 days', week, []], ['25 km, next 30 days', month, []], ['25 km, next 30 days, style "swing" with descendants', month, ['swing']]];
    for (const [label, to, styles] of cases) {
      const times: number[] = [];
      let rows = 0;
      for (let run = 0; run < RUNS; run++) {
        const city = cities[run % cities.length], start = performance.now();
        const result = await tx.$queryRawUnsafe<unknown[]>(query, city.lng, city.lat, RADIUS_M, from, to, styles, LIMIT);
        times.push(performance.now() - start);
        rows += result.length;
      }
      // The first round trip includes planning with cold caches; it stays in the figures on purpose.
      times.sort((a, b) => a - b);
      const median = percentile(times, 0.5), p95 = percentile(times, 0.95);
      console.log(`\n${label}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms over ${RUNS} runs (client round trip, avg ${Math.round(rows / RUNS)} rows, limit ${LIMIT}).`);
      if (p95 > TARGET_MS) { failed = true; console.error(`FAIL: p95 is above the ${TARGET_MS} ms target.`); }
    }
    const centre = cities.find(city => city.name === 'Madrid') || cities[0];
    const plan = (await tx.$queryRawUnsafe<{'QUERY PLAN': string}[]>('EXPLAIN (ANALYZE, BUFFERS) ' + query, centre.lng, centre.lat, RADIUS_M, from, week, [], LIMIT))
      .map(row => row['QUERY PLAN']).join('\n');
    console.log(`\nEXPLAIN ANALYZE, 25 km around ${centre.name}, next 7 days:\n${plan}`);
    const execution = Number(plan.match(/Execution Time: ([\d.]+) ms/)?.[1]);
    if (!plan.includes('event_geo_idx')) { failed = true; console.error('FAIL: the plan does not use the GiST index event_geo_idx.'); }
    else console.log(`\nGiST index event_geo_idx is used; server-side execution ${execution} ms (target <= ${TARGET_MS} ms).`);
    if (!(execution <= TARGET_MS)) failed = true;
    throw rollback;
  }, {timeout: 600000, maxWait: 20000}).catch(error => { if (error !== rollback) throw error; });
  const [{count}] = await db.$queryRawUnsafe<{count: bigint}[]>(`SELECT count(*) FROM "Event" WHERE id LIKE 'bench-%'`);
  if (count !== 0n) throw new Error(`Benchmark rows left behind: ${count}`);
  // Rolled-back rows are dead tuples; reclaim them and refresh the planner statistics.
  for (const table of ['Event', 'EventOccurrence', 'EventStyle']) await db.$executeRawUnsafe(`VACUUM (ANALYZE) "${table}"`);
  console.log('\nRolled back: 0 benchmark rows remain; tables vacuumed.');
} finally {
  await db.$disconnect();
}
if (failed) process.exitCode = 1;
