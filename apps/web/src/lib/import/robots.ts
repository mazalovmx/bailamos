import {withRedis} from '../redis';
import {ImportFetchError, importUserAgent, safeFetch} from './fetch';
// robots.txt (RFC 9309) for pages the importer reads as a crawler would: Schema.org sources. Feeds a site publishes for
// syndication (RSS, iCal) are not checked. One fetch per origin per day, shared between workers through Redis.
export type RobotsRule = {allow: boolean; path: string};
export type RobotsGroup = {agents: string[]; rules: RobotsRule[]};
const MAX_BYTES = 500 * 1024, MAX_RULES = 2000;
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null, open = false, rules = 0;
  for (const raw of text.slice(0, MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim(), colon = line.indexOf(':');
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // Consecutive User-agent lines share the rules that follow them.
      if (!current || !open) groups.push(current = {agents: [], rules: []});
      current.agents.push(value.toLowerCase());
      open = true;
    } else if (field === 'allow' || field === 'disallow') {
      open = false;
      // Rules before any User-agent line belong to nobody; an empty Disallow allows everything.
      if (current && value && rules++ < MAX_RULES) current.rules.push({allow: field === 'allow', path: value});
    }
    // Sitemap, Crawl-delay and unknown fields neither start nor end a group.
  }
  return groups;
}
// "dance-community-importer/0.1 (+https://…)" → "dance-community-importer"
export const productToken = (userAgent: string) => (/^[A-Za-z_-]+/.exec(userAgent.trim())?.[0] || '').toLowerCase();
/** The rules that apply to us: every group naming our product token, otherwise the "*" groups. */
export function rulesFor(groups: RobotsGroup[], userAgent: string): RobotsRule[] {
  const token = productToken(userAgent);
  const named = token ? groups.filter(group => group.agents.some(agent => agent !== '*' && agent === token)) : [];
  return (named.length ? named : groups.filter(group => group.agents.includes('*'))).flatMap(group => group.rules);
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "*" matches any run of characters, a trailing "$" anchors the end; everything else is a prefix match.
function matches(pattern: string, path: string) {
  const anchored = pattern.endsWith('$'), body = anchored ? pattern.slice(0, -1) : pattern;
  return new RegExp('^' + body.split('*').map(escape).join('.*') + (anchored ? '$' : '')).test(path);
}
// Percent-encoding is compared case-insensitively and unreserved characters decoded, so "/a%2Fb" and "/a%2fb" agree.
const normalize = (path: string) => path.replace(/%([0-9a-f]{2})/gi, (whole, hex: string) => {
  const char = String.fromCharCode(parseInt(hex, 16));
  return /[A-Za-z0-9._~-]/.test(char) ? char : '%' + hex.toUpperCase();
});
/** Longest matching rule wins; on a tie Allow wins; no matching rule means allowed. `path` includes the query string. */
export function isAllowed(rules: RobotsRule[], path: string): boolean {
  const target = normalize(path || '/');
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    const pattern = normalize(rule.path);
    if (!pattern.startsWith('/') && !pattern.startsWith('*')) continue;
    if (!matches(pattern, target)) continue;
    if (!best || pattern.length > normalize(best.path).length || (pattern.length === normalize(best.path).length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}
type Entry = {state: 'rules'; text: string} | {state: 'open'} | {state: 'closed'};
const DAY_SEC = 86_400, RETRY_SEC = 3600;
const memory = new Map<string, {entry: Entry; expires: number}>();
export const clearRobotsMemory = () => memory.clear();
const cacheKey = (origin: string) => 'import:robots:' + origin;
async function load(origin: string): Promise<{entry: Entry; ttl: number}> {
  try {
    const response = await safeFetch(origin + '/robots.txt', {accept: 'text/plain, */*;q=0.1', maxBytes: MAX_BYTES});
    // A redirect that left the site says nothing about this site's rules.
    if (new URL(response.url).host !== new URL(origin).host) return {entry: {state: 'open'}, ttl: DAY_SEC};
    return {entry: {state: 'rules', text: response.body}, ttl: DAY_SEC};
  } catch (error) {
    const status = error instanceof ImportFetchError ? error.status : undefined;
    // RFC 9309: "unavailable" (4xx) means no restrictions; "unreachable" (5xx, network) means assume everything is
    // disallowed — asked again sooner than a real answer would be.
    if (status && status >= 400 && status < 500 && status !== 429) return {entry: {state: 'open'}, ttl: DAY_SEC};
    return {entry: {state: 'closed'}, ttl: RETRY_SEC};
  }
}
async function entryFor(origin: string, now: number): Promise<Entry> {
  const key = cacheKey(origin), local = memory.get(key);
  if (local && local.expires > now) return local.entry;
  const shared = await withRedis(async redis => {
    const value = await redis.get(key);
    try {return value ? JSON.parse(value) as Entry : null;} catch {return null;}
  });
  if (shared && ['rules', 'open', 'closed'].includes(shared.state)) {
    memory.set(key, {entry: shared, expires: now + 600_000});
    return shared;
  }
  const {entry, ttl} = await load(origin);
  if (memory.size > 500) memory.clear();
  memory.set(key, {entry, expires: now + ttl * 1000});
  await withRedis(redis => redis.set(key, JSON.stringify(entry), 'EX', ttl));
  return entry;
}
/** May the importer read this page? Never throws: an unreachable robots.txt answers "UNREACHABLE" (treated as no). */
export async function robotsVerdict(url: URL, now = Date.now()): Promise<'ALLOWED' | 'DISALLOWED' | 'UNREACHABLE'> {
  const entry = await entryFor(url.origin, now);
  if (entry.state === 'open') return 'ALLOWED';
  if (entry.state === 'closed') return 'UNREACHABLE';
  return isAllowed(rulesFor(parseRobots(entry.text), importUserAgent()), url.pathname + url.search) ? 'ALLOWED' : 'DISALLOWED';
}
/** For safeFetch's `check`: refuses a hop that robots.txt closes to us. */
export async function assertRobots(url: URL) {
  const verdict = await robotsVerdict(url);
  if (verdict !== 'ALLOWED') throw new ImportFetchError('ROBOTS_' + verdict);
}
