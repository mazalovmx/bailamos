import {db} from '@dance/db';
// Fixed-window counter in the shared RateLimit table, so the limit holds across server instances.
// Returns false when the caller is over the limit.
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now(), windowStart = now - windowSeconds * 1000;
  const rows = await db.$queryRaw<{count: number}[]>`
    INSERT INTO "RateLimit" (id, key, count, "lastRequest") VALUES (gen_random_uuid()::text, ${'geo:' + key}, 1, ${now}::bigint)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."lastRequest" < ${windowStart}::bigint THEN 1 ELSE "RateLimit".count + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${windowStart}::bigint THEN ${now}::bigint ELSE "RateLimit"."lastRequest" END
    RETURNING count`;
  return Number(rows[0].count) <= max;
}
