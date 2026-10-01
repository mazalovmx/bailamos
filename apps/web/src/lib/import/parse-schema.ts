import {load, type CheerioAPI} from 'cheerio';
import {createHash} from 'node:crypto';
import {coordinate, parseWhen, plain, safeUrl} from './text';
import {MAX_ITEMS, type ParsedEvent} from './types';
// Schema.org Event from a web page: JSON-LD first (single object, array, @graph, nested lists), microdata as a fallback.
type Node = Record<string, unknown>;
type AnyNode = ReturnType<CheerioAPI>[number];
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const typeNames = (value: unknown) => list(value).filter((name): name is string => typeof name === 'string').map(name => name.replace(/^https?:\/\/schema\.org\//i, ''));
// Event and its subtypes (DanceEvent, MusicEvent, SocialEvent, EducationEvent, Festival, CourseInstance ...).
const isEventType = (value: unknown) => typeNames(value).some(name => /Event$/.test(name) || name === 'Festival' || name === 'CourseInstance');
const string = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value)
  : Array.isArray(value) ? string(value[0]) : isNode(value) ? string(value['@value'] ?? value.name ?? value['@id'] ?? '') : '';
function collect(value: unknown, found: Node[], depth = 0, budget = {left: 5000}) {
  if (depth > 8 || budget.left-- <= 0) return;
  if (Array.isArray(value)) {for (const entry of value) collect(entry, found, depth + 1, budget); return;}
  if (!isNode(value)) return;
  if (isEventType(value['@type'])) found.push(value);
  for (const [key, entry] of Object.entries(value)) if (key !== 'superEvent' && entry && typeof entry === 'object') collect(entry, found, depth + 1, budget);
}
function address(value: unknown): string {
  if (!isNode(value)) return plain(string(value), 300);
  const country = string(value.addressCountry);
  return plain([value.streetAddress, value.postalCode, value.addressLocality, value.addressRegion, country].map(string).filter(Boolean).join(', '), 300);
}
type Draft = {id?: string; name?: string; description?: string; start?: string; end?: string; url?: string; status?: string;
  venueName?: string; address?: string; lat?: unknown; lng?: unknown};
function place(value: unknown): Pick<Draft, 'venueName' | 'address' | 'lat' | 'lng'> {
  // Online-only "places" carry no address; the first physical one wins.
  const location = list(value).find(entry => !isNode(entry) || !typeNames(entry['@type']).includes('VirtualLocation'));
  if (!isNode(location)) return {address: plain(string(location), 300) || undefined};
  const geo = isNode(location.geo) ? location.geo : location;
  return {venueName: plain(string(location.name), 160) || undefined, address: address(location.address) || undefined, lat: geo.latitude, lng: geo.longitude};
}
function finish(draft: Draft, base?: string): ParsedEvent {
  const title = plain(draft.name, 120), start = parseWhen(draft.start), end = parseWhen(draft.end), url = safeUrl(draft.url, base);
  const lat = coordinate(draft.lat, 90), lng = coordinate(draft.lng, 180), when = start.local || start.instant?.toISOString() || '';
  // One page often lists several dates of the same show under one URL, so the date is part of the identity.
  const externalId = plain(draft.id || (url ? url + '#' + when : ''), 300) || 'h:' + createHash('sha256').update(title + '|' + when).digest('hex').slice(0, 32);
  return {externalId, title, description: plain(draft.description, 5000, true) || undefined, url,
    startsAt: start.instant, startsLocal: start.local, allDay: start.allDay, endsAt: end.instant, endsLocal: end.local,
    venueName: draft.venueName, address: draft.address, ...(lat !== undefined && lng !== undefined && !(lat === 0 && lng === 0) ? {lat, lng} : {}),
    cancelled: /Cancelled/i.test(draft.status || '') || undefined};
}
function jsonLd($: CheerioAPI): Draft[] {
  const found: Node[] = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    const raw = $(script).text().replace(/^\s*(<!--|\/\/\s*<!\[CDATA\[)/, '').replace(/(-->|\/\/\s*\]\]>)\s*$/, '');
    try {collect(JSON.parse(raw), found);} catch {/* one broken block does not spoil the page */}
  });
  return found.map(node => ({id: string(node['@id']) || undefined, name: string(node.name), description: string(node.description),
    start: string(node.startDate), end: string(node.endDate), url: string(node.url), status: string(node.eventStatus), ...place(node.location)}));
}
function microdata($: CheerioAPI): Draft[] {
  // Properties of a scope are the itemprop elements whose nearest enclosing itemscope is that scope.
  const props = (scope: AnyNode, name: string) => $(scope).find('[itemprop~="' + name + '"]').filter((_, element) => $(element).parent().closest('[itemscope]')[0] === scope);
  const read = (scope: AnyNode, name: string) => {
    const element = props(scope, name).first();
    if (!element.length) return '';
    return element.attr('content') ?? element.attr('datetime') ?? element.attr('href') ?? element.attr('src') ?? element.html() ?? '';
  };
  const drafts: Draft[] = [];
  $('[itemscope][itemtype]').each((_, scope) => {
    if (!isEventType(($(scope).attr('itemtype') || '').split(/\s+/))) return;
    const draft: Draft = {id: $(scope).attr('itemid'), name: read(scope, 'name'), description: read(scope, 'description'),
      start: read(scope, 'startDate'), end: read(scope, 'endDate'), url: read(scope, 'url'), status: read(scope, 'eventStatus')};
    const location = props(scope, 'location').first()[0];
    if (location && $(location).is('[itemscope]')) {
      const street = props(location, 'address').first()[0], geo = props(location, 'geo').first()[0];
      draft.venueName = plain(read(location, 'name'), 160) || undefined;
      draft.address = (street && $(street).is('[itemscope]')
        ? plain(['streetAddress', 'postalCode', 'addressLocality', 'addressRegion', 'addressCountry'].map(name => read(street, name).trim()).filter(Boolean).join(', '), 300)
        : plain(read(location, 'address'), 300)) || undefined;
      const holder = geo && $(geo).is('[itemscope]') ? geo : location;
      draft.lat = read(holder, 'latitude');
      draft.lng = read(holder, 'longitude');
    } else if (location) draft.address = plain(read(scope, 'location'), 300) || undefined;
    drafts.push(draft);
  });
  return drafts;
}
export function parseSchemaOrg(html: string, base?: string): ParsedEvent[] {
  const $ = load(html.slice(0, 4_000_000));
  let drafts = jsonLd($);
  if (!drafts.length) drafts = microdata($);
  const items = new Map<string, ParsedEvent>();
  for (const draft of drafts.slice(0, MAX_ITEMS)) {
    const item = finish(draft, base);
    if (!items.has(item.externalId)) items.set(item.externalId, item);
  }
  return [...items.values()];
}
