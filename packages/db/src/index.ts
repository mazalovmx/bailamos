import {PrismaClient} from '@prisma/client';
// Slow-query tracing: every query that takes SLOW_QUERY_MS (default 500; 0 switches it off) or longer is logged as one
// line of JSON — duration and the SQL text, shortened, with literals masked and without the bound parameter values
// (they hold user data). At most SLOW_QUERY_LOGS_PER_MIN (default 30) lines a minute per process; what was held back
// is reported as `suppressed` on the next line, so a slow database cannot flood the log.
export type SlowQueryState = {windowStart: number; logged: number; suppressed: number};
export const slowQueryMs = () => {
  const value = Number(process.env.SLOW_QUERY_MS);
  return process.env.SLOW_QUERY_MS?.trim() && Number.isFinite(value) && value >= 0 ? value : 500;
};
const perMinute = () => {
  const value = Number(process.env.SLOW_QUERY_LOGS_PER_MIN);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 30;
};
/** SQL text fit for a log: one line, string and long numeric literals masked, cut to `max` characters. */
export function sqlForLog(query: string, max = 300) {
  const text = query.replace(/'(?:[^']|'')*'/g, "'?'").replace(/\b\d{4,}\b/g, '?').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}
/** The log line for a query event, or null when it is fast enough or the minute's quota is used up. */
export function slowQueryLine(event: {query: string; duration: number; target?: string}, state: SlowQueryState, now = Date.now(), thresholdMs = slowQueryMs(), limit = perMinute()) {
  if (!(thresholdMs > 0) || event.duration < thresholdMs) return null;
  if (now - state.windowStart >= 60_000) {state.windowStart = now; state.logged = 0;}
  if (state.logged >= limit) {state.suppressed++; return null;}
  state.logged++;
  const line = {level: 'warn', event: 'slow_query', ms: Math.round(event.duration), thresholdMs, sql: sqlForLog(event.query), ...(state.suppressed ? {suppressed: state.suppressed} : {})};
  state.suppressed = 0;
  return line;
}
function create() {
  // Decided once: with tracing off no query events are produced at all.
  if (slowQueryMs() <= 0) return new PrismaClient();
  const client = new PrismaClient({log: [{emit: 'event', level: 'query'}]}), state: SlowQueryState = {windowStart: 0, logged: 0, suppressed: 0};
  client.$on('query', event => {
    const line = slowQueryLine(event, state);
    if (line) console.warn(JSON.stringify(line));
  });
  return client as unknown as PrismaClient;
}
const globalDb = globalThis as unknown as {prisma?: PrismaClient};
export const db = globalDb.prisma ?? create();
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
export * from '@prisma/client';
