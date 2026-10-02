import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
// The suite never touches the network: the importer's transport and resolver, the geocoder and the Bot API are all replaced.
process.env.GEOCODER_URL = 'http://geocoder.test';
process.env.IMPORT_USER_AGENT = 'dance-test-importer/1.0 (+https://dance.example/bot)';
import {DateTime} from 'luxon';
import {db} from '@dance/db';
import {closeRedis} from '../src/lib/redis';
import {siteUrl} from '../src/lib/mail';
import {plain, safeUrl, parseWhen} from '../src/lib/import/text';
import {parseNews, parseRssEvents} from '../src/lib/import/parse-rss';
import {parseIcal} from '../src/lib/import/parse-ical';
import {parseSchemaOrg} from '../src/lib/import/parse-schema';
import {assertPublicUrl, ImportFetchError, isPrivateAddress, safeFetch, setImportNet, type Transport, type TransportResponse} from '../src/lib/import/fetch';
import {dedupeKey, eventDedupeKey, fuzzyMatch, normalizeTitle, placeKey, titleSimilarity} from '../src/lib/import/dedupe';
import {processApproved, readState, runSource} from '../src/lib/import/run';
import {approveItem, rejectItem, ReviewError} from '../src/lib/import/review';
import {importJobs, isDue, pruneNews} from '../src/lib/import/jobs';
import {secretMatches} from '../src/lib/import/secret';
import {clearRobotsMemory, isAllowed, parseRobots, productToken, robotsVerdict, rulesFor} from '../src/lib/import/robots';
import {contentHash, futureDates, readSync, type Payload} from '../src/lib/import/create';
import {describeChange} from '../src/lib/import/sync';
import {schedule} from '../src/lib/schedule';
import {esc} from '../src/lib/telegram/api';
import {fuzzyPick, handleUpdate, range} from '../src/lib/telegram/bot';
import {createLinkToken} from '../src/lib/telegram/link';
import {telegramDelivery} from '../src/lib/telegram/delivery';
const fixture = (name: string) => readFileSync(new URL('./fixtures/import/' + name, import.meta.url), 'utf8');
const tag = randomBytes(3).toString('hex');
const PUBLIC = [{address: '93.184.216.34', family: 4}];
// ---------- text ----------
test('feed text is reduced to plain text: tags, scripts, encoded markup and control characters are gone', () => {
  assert.equal(plain('<p>Hello <b>world</b></p><script>alert(1)</script>'), 'Hello world');
  assert.equal(plain('&lt;img src=x onerror=alert(1)&gt;Hi &amp;amp; bye'), 'Hi & bye');
  assert.equal(plain('a <3 b > c'), 'a 3 b c');
  assert.equal(plain('line one<br>line two<p>three</p>', 100, true), 'line one\nline two\nthree');
  assert.equal(plain('x'.repeat(50), 10), 'x'.repeat(10));
  assert.equal(plain('zero' + String.fromCharCode(0x200b) + 'width' + String.fromCharCode(7)), 'zerowidth');
  assert.equal(plain({toString: () => '<b>x</b>'}), '');
  for (const value of ['<style>p{}</style>ok', '<iframe src="//evil"></iframe>ok', '<svg onload=alert(1)></svg>ok']) assert.equal(plain(value), 'ok', value);
  assert.equal(safeUrl('/a?b=1', 'https://site.example/feed'), 'https://site.example/a?b=1');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', 'https://user:pw@x.example/', '', 'x'.repeat(2100)]) assert.equal(safeUrl(bad), undefined, bad);
  assert.deepEqual(parseWhen('2099-05-01'), {local: '2099-05-01T00:00', allDay: true});
  assert.deepEqual(parseWhen('2099-05-01T19:30'), {local: '2099-05-01T19:30'});
  assert.equal(parseWhen('2099-05-01T19:30:00+02:00').instant?.toISOString(), '2099-05-01T17:30:00.000Z');
  assert.equal(parseWhen('Mon, 14 Sep 2026 09:30:00 GMT').instant?.toISOString(), '2026-09-14T09:30:00.000Z');
  assert.deepEqual(parseWhen('soon'), {});
});
// ---------- parsers ----------
test('RSS and Atom news: links resolved, summaries stripped and truncated, dates sane', async () => {
  const now = new Date('2026-10-01T00:00:00Z'), news = await parseNews(fixture('news.rss.xml'), now);
  assert.deepEqual(news.map(item => item.url), ['https://news.example.org/herrang-2027', 'https://news.example.org/stories/relative',
    'https://news.example.org/future', 'https://news.example.org/long']);
  assert.equal(news[0].title, 'Herrang announces 2027 dates');
  assert.equal(news[0].summary, 'The camp returns next summer.');
  assert.equal(news[0].publishedAt.toISOString(), '2026-09-14T09:30:00.000Z');
  assert.equal(news[1].summary, 'Plain & simple');
  assert.equal(news[2].publishedAt.getTime(), now.getTime(), 'a date in the future is clamped');
  assert.ok(news[3].summary!.length <= 300 && news[3].summary!.length > 250);
  for (const item of news) assert.equal(/[<>]|javascript:|onerror|alert/.test(JSON.stringify(item)), false);
  const atom = await parseNews(fixture('news.atom.xml'), now);
  assert.deepEqual(atom.map(item => [item.url, item.title, item.summary, item.publishedAt.toISOString()]), [
    ['https://blog.example.net/pure-bal', 'Pure Bal & friends', 'Why pure balboa matters.', '2026-09-20T12:00:00.000Z'],
    ['https://blog.example.net/second', 'Second entry', 'Body text', '2026-09-18T06:00:00.000Z']]);
});
test('RSS events need a real event date (ev:startdate), never the publication date', async () => {
  const [shag, floating, post] = await parseRssEvents(fixture('events.rss.xml'));
  assert.deepEqual({...shag, startsAt: shag.startsAt?.toISOString(), endsAt: shag.endsAt?.toISOString()}, {
    externalId: 'shag-night-1', title: 'Shag Night', description: 'Collegiate shag all night', url: 'https://agenda.example.org/shag-night',
    startsAt: '2099-05-02T18:30:00.000Z', endsAt: '2099-05-02T21:30:00.000Z', startsLocal: undefined, endsLocal: undefined, allDay: undefined,
    venueName: 'Club Swing', address: 'Club Swing, Calle Mayor 1, Madrid', lat: 40.4155, lng: -3.7074});
  assert.equal(floating.startsLocal, '2099-05-03T19:00');
  assert.equal(floating.startsAt, undefined);
  assert.equal(post.startsAt ?? post.startsLocal, undefined);
});
test('iCal: TZID, all-day, floating times, weekly RRULE kept, other rules expanded', () => {
  const now = new Date('2026-10-01T08:00:00Z'), items = new Map(parseIcal(fixture('calendar.ics'), now).map(item => [item.externalId.split('@')[0], item]));
  assert.equal(items.size, 8);
  const social = items.get('social-2099')!;
  assert.equal(social.title, 'Friday Lindy Social');
  assert.equal(social.description, 'Live band & DJ.\nBring shoes.');
  assert.equal(social.startsAt?.toISOString(), '2099-06-12T19:00:00.000Z');
  assert.equal(social.endsAt?.toISOString(), '2099-06-12T21:59:00.000Z');
  assert.equal(social.timezone, 'Europe/Madrid');
  assert.deepEqual([social.venueName, social.address, social.lat, social.lng, social.url],
    ['Sala Clamores', 'Sala Clamores, Calle de Alburquerque 14, Madrid', 40.431, -3.7009, 'https://swingmadrid.example/social']);
  const weekly = items.get('weekly-2099')!;
  assert.equal(weekly.timezone, 'America/New_York');
  assert.equal(weekly.startsAt?.toISOString(), '2099-06-15T23:00:00.000Z');
  assert.deepEqual(weekly.recurrence, {interval: 1, byDay: ['MO', 'WE'], count: 6});
  assert.equal(weekly.occurrences, undefined);
  // The mapped rule is exactly what lib/schedule.ts stores for an event made on the site.
  const plan = schedule('2099-06-15T19:00', '2099-06-15T20:30', 'America/New_York', weekly.recurrence);
  assert.equal(plan.occurrences.length, 6);
  assert.equal(plan.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6');
  // A series that started years ago is rolled forward to its next date.
  const ongoing = items.get('ongoing-2024')!;
  assert.equal(ongoing.startsAt?.toISOString(), '2026-10-06T18:00:00.000Z');
  assert.equal(ongoing.endsAt?.toISOString(), '2026-10-06T19:30:00.000Z');
  assert.deepEqual(ongoing.recurrence, {interval: 2, byDay: [], count: 26});
  const monthly = items.get('monthly-2024')!;
  assert.equal(monthly.recurrence, undefined, 'monthly rules are not something the event form can express');
  assert.equal(monthly.rrule, 'FREQ=MONTHLY;BYDAY=3SA');
  assert.deepEqual(monthly.occurrences?.slice(0, 2).map(date => date.startsAt.toISOString()), ['2026-10-17T18:00:00.000Z', '2026-11-21T18:00:00.000Z']);
  assert.equal(monthly.startsAt?.toISOString(), '2026-10-17T18:00:00.000Z');
  const festival = items.get('festival-2099')!;
  assert.deepEqual([festival.allDay, festival.startsLocal, festival.endsLocal, festival.startsAt], [true, '2099-07-03T00:00', '2099-07-06T00:00', undefined]);
  const floating = items.get('floating-2099')!;
  assert.deepEqual([floating.startsLocal, floating.endsLocal, floating.timezone], ['2099-07-10T19:30', '2099-07-10T21:30', undefined]);
  assert.equal(items.get('cancelled-2099')!.cancelled, true);
  assert.equal(items.get('old-2001')!.startsAt?.toISOString(), '2001-01-05T20:00:00.000Z');
  assert.equal(/[<>]/.test(JSON.stringify([...items.values()])), false);
});
test('Schema.org JSON-LD: single object, @graph with nested lists, arrays; microdata fallback', () => {
  const [single, ...rest] = parseSchemaOrg(fixture('jsonld-single.html'), 'https://venue.example.com/agenda');
  assert.equal(rest.length, 0, 'a broken JSON-LD block is skipped');
  assert.deepEqual({...single, startsAt: single.startsAt?.toISOString(), endsAt: single.endsAt?.toISOString()}, {
    externalId: 'https://venue.example.com/events/42', title: 'Swing Party & Jam', description: 'Great night.\n\nSecond line',
    url: 'https://venue.example.com/events/42', startsAt: '2099-04-18T19:00:00.000Z', endsAt: '2099-04-19T00:00:00.000Z',
    startsLocal: undefined, endsLocal: undefined, allDay: undefined, venueName: 'Sala Caracol',
    address: 'Calle de Bernardino Obregon 18, 28012, Madrid, ES', lat: 40.4019, lng: -3.6966, cancelled: undefined});
  const graph = parseSchemaOrg(fixture('jsonld-graph.html'));
  assert.deepEqual(graph.map(item => item.title), ['Tea dance', 'Spring Festival', 'Cancelled concert']);
  assert.deepEqual([graph[0].startsLocal, graph[0].venueName, graph[0].address], ['2099-04-20T17:00', 'Hotel Ritz', 'Plaza de la Lealtad 5, Madrid']);
  assert.deepEqual([graph[1].allDay, graph[1].startsLocal, graph[1].endsLocal, graph[1].address], [true, '2099-05-01T00:00', '2099-05-03T00:00', 'Barcelona']);
  assert.equal(graph[2].cancelled, true);
  const array = parseSchemaOrg(fixture('jsonld-array.html'));
  assert.equal(array.length, 3);
  assert.notEqual(array[0].externalId, array[1].externalId, 'two dates of one show under one URL stay two items');
  assert.equal(array[2].startsAt ?? array[2].startsLocal, undefined);
  const micro = parseSchemaOrg(fixture('microdata.html'), 'https://venue.example.com/agenda');
  assert.equal(micro.length, 2);
  assert.deepEqual([micro[0].title, micro[0].description, micro[0].url, micro[0].startsAt?.toISOString(), micro[0].endsAt?.toISOString()],
    ['Blues Night', 'Slow drag & blues.', 'https://venue.example.com/blues-night', '2099-07-11T20:00:00.000Z', '2099-07-12T01:00:00.000Z']);
  assert.deepEqual([micro[0].venueName, micro[0].address, micro[0].lat, micro[0].lng], ['El Sotano', 'Calle del Pez 7, Madrid', 40.4235, -3.7062]);
  assert.deepEqual([micro[1].title, micro[1].startsLocal, micro[1].address], ['Text location event', '2099-07-12T18:00', 'Parque del Retiro, Madrid']);
  assert.equal(/[<>]|alert/.test(JSON.stringify([single, graph, array, micro])), false);
});
// ---------- fetcher ----------
const ok = (body: string, headers: Record<string, string> = {}): TransportResponse => ({status: 200, headers, body: Buffer.from(body)});
test('SSRF guard: private, loopback, link-local and metadata addresses are refused, also behind DNS and redirects', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00:ec2::254', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', 'not-an-ip'])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(address), false, address);
  const resolver = async (host: string) => host === 'rebind.example.org' ? [{address: '93.184.216.34', family: 4}, {address: '10.0.0.5', family: 4}]
    : host === 'internal.example.org' ? [{address: '192.168.0.10', family: 4}] : host === 'v6.example.org' ? [{address: '::1', family: 6}] : PUBLIC;
  const refused = async (url: string, code: string) => assert.rejects(assertPublicUrl(new URL(url), resolver), (error: unknown) => error instanceof ImportFetchError && error.code === code, url);
  for (const url of ['http://127.0.0.1/', 'http://10.1.2.3/feed', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', 'http://0x7f.0.0.1/', 'http://localhost/', 'http://metadata.google.internal/', 'http://printer.local/',
    'https://internal.example.org/', 'https://rebind.example.org/', 'https://v6.example.org/']) await refused(url, 'PRIVATE_ADDRESS');
  for (const url of ['file:///etc/passwd', 'ftp://example.org/', 'gopher://example.org/']) await refused(url, 'BAD_SCHEME');
  await refused('https://user:pw@example.org/', 'BAD_URL');
  await refused('http://example.org:6379/', 'BAD_PORT');
  assert.deepEqual(await assertPublicUrl(new URL('https://example.org/feed'), resolver), PUBLIC);
  const seen: string[] = [];
  const transport: Transport = async url => {
    seen.push(url.toString());
    if (url.pathname === '/to-private') return {status: 302, headers: {location: 'http://169.254.169.254/latest/meta-data/'}, body: Buffer.alloc(0)};
    if (url.pathname === '/to-internal-name') return {status: 301, headers: {location: 'https://internal.example.org/feed'}, body: Buffer.alloc(0)};
    if (url.pathname === '/loop') return {status: 302, headers: {location: '/loop'}, body: Buffer.alloc(0)};
    if (url.pathname === '/hop') return {status: 307, headers: {location: 'https://other.example.org/final'}, body: Buffer.alloc(0)};
    if (url.pathname === '/missing') return {status: 404, headers: {}, body: Buffer.alloc(0)};
    return ok('final body');
  };
  setImportNet({resolve: resolver, transport, delayMs: 0});
  const fails = (url: string, code: string) => assert.rejects(safeFetch(url), (error: unknown) => error instanceof ImportFetchError && error.code === code, url);
  await fails('https://example.org/to-private', 'PRIVATE_ADDRESS');
  await fails('https://example.org/to-internal-name', 'PRIVATE_ADDRESS');
  assert.equal(seen.some(url => url.includes('169.254') || url.startsWith('https://internal.')), false, 'the private hop is never requested');
  await fails('https://example.org/loop', 'TOO_MANY_REDIRECTS');
  assert.equal(seen.filter(url => url.endsWith('/loop')).length, 4, 'the first request plus three redirects');
  await fails('https://example.org/missing', 'HTTP_404');
  await fails('http://127.0.0.1:8080/feed', 'PRIVATE_ADDRESS');
  await fails('not a url', 'BAD_URL');
  const hopped = await safeFetch('https://example.org/hop');
  assert.deepEqual([hopped.status, hopped.body, hopped.url], [200, 'final body', 'https://other.example.org/final']);
});
test('fetcher: honest User-Agent, conditional GET, size limit, charset and per-host delay', async () => {
  const requests: {url: string; headers: Record<string, string>; at: number}[] = [];
  setImportNet({resolve: async () => PUBLIC, delayMs: 0, transport: async (url, options) => {
    requests.push({url: url.toString(), headers: options.headers, at: Date.now()});
    if (url.pathname === '/big') return ok('x'.repeat(options.maxBytes + 1));
    if (url.pathname === '/latin1') return {status: 200, headers: {'content-type': 'text/xml; charset=iso-8859-1'}, body: Buffer.from([0x4f, 0x6c, 0xe9])};
    if (options.headers['If-None-Match'] === '"v1"') return {status: 304, headers: {}, body: Buffer.alloc(0)};
    return ok('fresh', {etag: '"v1"', 'last-modified': 'Mon, 14 Sep 2026 09:30:00 GMT'});
  }});
  const first = await safeFetch('https://example.org/feed');
  assert.deepEqual([first.notModified, first.body, first.etag, first.lastModified], [false, 'fresh', '"v1"', 'Mon, 14 Sep 2026 09:30:00 GMT']);
  assert.equal(requests[0].headers['User-Agent'], 'dance-test-importer/1.0 (+https://dance.example/bot)');
  assert.equal('If-None-Match' in requests[0].headers, false);
  const second = await safeFetch('https://example.org/feed', {etag: first.etag, lastModified: first.lastModified});
  assert.deepEqual([second.status, second.notModified, second.body, second.etag], [304, true, '', '"v1"']);
  assert.equal(requests[1].headers['If-Modified-Since'], 'Mon, 14 Sep 2026 09:30:00 GMT');
  await assert.rejects(safeFetch('https://example.org/big', {maxBytes: 1000}), (error: unknown) => error instanceof ImportFetchError && error.code === 'TOO_LARGE');
  assert.equal((await safeFetch('https://example.org/latin1')).body, 'Ol' + String.fromCharCode(0xe9));
  setImportNet({delayMs: 120});
  requests.length = 0;
  await safeFetch('https://slow.example.org/a');
  await safeFetch('https://slow.example.org/b');
  await safeFetch('https://another.example.org/c');
  assert.ok(requests[1].at - requests[0].at >= 100, 'the same host waits');
  assert.ok(requests[2].at - requests[1].at < 100, 'another host does not');
  setImportNet({delayMs: 0});
});
test('robots.txt: groups, our User-Agent before "*", longest match, Allow on a tie, wildcards', () => {
  const groups = parseRobots([
    '# comment', 'Disallow: /orphan-rule-before-any-group', '',
    'User-agent: *', 'Disallow: /private/', 'Disallow: /*.pdf$', 'Allow: /private/agenda', 'Disallow: /search?q=', 'Crawl-delay: 10', 'Sitemap: https://example.org/sitemap.xml', '',
    'User-agent: BadBot', 'User-agent: Dance-Test-Importer', 'Disallow: /events/drafts', 'Allow: /events/', 'Disallow: /', '',
    'User-agent: dance-test-importer   # a second group for the same agent is merged', 'Allow: /agenda$', 'Disallow:', 'not a rule at all'].join('\r\n'));
  assert.deepEqual(groups.map(group => [group.agents, group.rules.length]), [[['*'], 4], [['badbot', 'dance-test-importer'], 3], [['dance-test-importer'], 1]]);
  assert.equal(productToken('dance-test-importer/1.0 (+https://dance.example/bot)'), 'dance-test-importer');
  const mine = rulesFor(groups, 'dance-test-importer/1.0 (+https://dance.example/bot)'), others = rulesFor(groups, 'other-crawler/2.0');
  assert.equal(mine.length, 4, 'both groups naming us, not the "*" group');
  // Longest match wins: /events/ (8) beats / (1), /events/drafts (14) beats /events/.
  assert.deepEqual(['/', '/events/', '/events/2026/jam', '/events/drafts', '/events/drafts/1', '/agenda', '/agenda/2', '/private/agenda'].map(path => isAllowed(mine, path)),
    [false, true, true, false, false, true, false, false]);
  assert.deepEqual(['/', '/private/', '/private/x', '/private/agenda', '/private/agenda/may', '/files/flyer.pdf', '/files/flyer.pdf?download=1', '/search?q=tango', '/search', '/events/drafts'].map(path => isAllowed(others, path)),
    [true, false, false, true, true, false, true, false, true, true]);
  // Equal length: Allow wins. Percent-encoding is compared in one form. No rules, or no group for us: everything is open.
  assert.equal(isAllowed([{allow: false, path: '/page'}, {allow: true, path: '/page'}], '/page'), true);
  assert.equal(isAllowed([{allow: false, path: '/caf%c3%a9'}], '/caf%C3%A9/menu'), false);
  assert.equal(isAllowed([{allow: false, path: '/a%2Fb'}], '/a/b'), true, 'an encoded slash is not a path separator');
  assert.equal(isAllowed([], '/anything'), true);
  assert.deepEqual(rulesFor(parseRobots('User-agent: googlebot\nDisallow: /'), 'dance-test-importer/1.0'), []);
  assert.deepEqual(parseRobots('<html><body>404</body></html>'), []);
  // A hostile file cannot make the matcher explode: wildcards are plain ".*", the rest is escaped.
  assert.equal(isAllowed([{allow: false, path: '/(a+)+$*[x'}], '/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'), true);
});
test('robots.txt is fetched once per host, honoured for Schema.org pages and their redirects, not for feeds', async () => {
  const hits: string[] = [], host = 'robots-' + tag + '.example.org';
  let robots: TransportResponse | Error = ok('User-agent: *\nDisallow: /closed/\n');
  setImportNet({resolve: async () => PUBLIC, delayMs: 0, transport: async url => {
    hits.push(url.pathname);
    if (url.pathname === '/robots.txt') {if (robots instanceof Error) throw robots; return robots;}
    if (url.pathname === '/open/moved') return {status: 302, headers: {location: '/closed/page'}, body: Buffer.alloc(0)};
    return ok(url.pathname.endsWith('.ics') ? 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' : jsonLd([]));
  }});
  clearRobotsMemory();
  const sources = await Promise.all([['SCHEMA_ORG', '/closed/agenda'], ['SCHEMA_ORG', '/open/agenda'], ['SCHEMA_ORG', '/open/moved'], ['ICAL', '/closed/calendar.ics']].map(([kind, path]) =>
    db.importSource.create({data: {kind: kind as 'SCHEMA_ORG' | 'ICAL', url: 'https://' + host + path, name: 'Robots ' + tag + path}})));
  cleanup.sources.push(...sources.map(source => source.id));
  try {
    const [closed, open, moved, calendar] = [await runSource(sources[0].id), await runSource(sources[1].id), await runSource(sources[2].id), await runSource(sources[3].id)];
    assert.deepEqual([closed.ok, closed.error], [false, 'ROBOTS_DISALLOWED']);
    assert.equal(readState((await db.importSource.findUniqueOrThrow({where: {id: sources[0].id}})).lastStatus).error, 'ROBOTS_DISALLOWED');
    assert.equal(open.ok, true);
    assert.deepEqual([moved.ok, moved.error], [false, 'ROBOTS_DISALLOWED'], 'a redirect into a closed path is refused too');
    assert.equal(calendar.ok, true, 'a published calendar feed is fetched regardless');
    assert.deepEqual(hits, ['/robots.txt', '/open/agenda', '/open/moved', '/closed/calendar.ics'], 'robots.txt once, the closed pages never');
    assert.equal(await robotsVerdict(new URL('https://' + host + '/closed/x?y=1')), 'DISALLOWED');
    // 4xx: no robots.txt, no restrictions. 5xx or no answer: assume closed, and ask again within the hour.
    for (const [answer, verdict] of [[{status: 404, headers: {}, body: Buffer.alloc(0)}, 'ALLOWED'], [{status: 503, headers: {}, body: Buffer.alloc(0)}, 'UNREACHABLE'], [new ImportFetchError('TIMEOUT'), 'UNREACHABLE']] as const) {
      robots = answer;
      const other = 'robots-' + tag + '-' + hits.length + '.example.org';
      assert.equal(await robotsVerdict(new URL('https://' + other + '/closed/agenda')), verdict);
      assert.equal(await robotsVerdict(new URL('https://' + other + '/again')), verdict, 'cached');
      assert.equal(hits.filter(path => path === '/robots.txt').length, hits.length - 3);
    }
  } finally {
    clearRobotsMemory();
    useFeedTransport();
  }
});
// ---------- de-duplication ----------
test('dedupe key: local day + ~100 m grid (or the city) + normalized title', () => {
  assert.equal(normalizeTitle('  The Friday Lindy-Hop SOCIAL!!! '), 'friday hop lindy social');
  assert.equal(normalizeTitle('Noche de Swing en el Retiro'), normalizeTitle('RETIRO: noche swing'));
  assert.equal(normalizeTitle('Canción & Milonguée'), 'cancion milonguee');
  assert.equal(normalizeTitle('Вечеринка в стиле свинг'), 'вечеринка свинг стиле');
  assert.equal(normalizeTitle('The'), 'the', 'a title of stop words keeps them');
  const base = {title: 'Friday Lindy Social', startsAt: new Date('2099-06-12T22:30:00Z'), timezone: 'Europe/Madrid', cityId: 'madrid', lat: 40.43104, lng: -3.70093};
  assert.equal(dedupeKey(base), '2099-06-13|40.431,-3.701|friday lindy social', 'the day is the local one');
  assert.equal(dedupeKey({...base, timezone: 'UTC'}), '2099-06-12|40.431,-3.701|friday lindy social');
  assert.equal(dedupeKey({...base, title: 'friday, LINDY social!', lat: 40.4312, lng: -3.7008}), dedupeKey(base), 'same 100 m cell and same words');
  assert.notEqual(dedupeKey({...base, lat: 40.436}), dedupeKey(base));
  assert.equal(placeKey({cityId: 'madrid'}), 'city:madrid');
  assert.equal(placeKey({cityId: 'madrid', lat: 40.4, lng: -3.7, precise: false}), 'city:madrid', 'city-centre coordinates are not a place');
  assert.equal(eventDedupeKey({...base, precise: false}), '2099-06-13|city:madrid|friday lindy social');
});
test('fuzzy match: similar title on the same day and place, or the same title within a few hours', () => {
  assert.equal(titleSimilarity('Friday Lindy Social', 'Lindy social (Friday)'), 1);
  assert.ok(titleSimilarity('Friday Lindy Social', 'Friday Lindy Social with live band') >= 0.6);
  assert.ok(titleSimilarity('Friday Lindy Social', 'Friday Lindi Socail') >= 0.6, 'typos');
  assert.ok(titleSimilarity('Friday Lindy Social', 'Tango marathon') < 0.3);
  const a = {title: 'Friday Lindy Social', startsAt: new Date('2099-06-12T19:00:00Z'), timezone: 'Europe/Madrid', cityId: 'm', lat: 40.4310, lng: -3.7009};
  assert.equal(fuzzyMatch(a, {...a, title: 'Friday Lindy Social with live band', lat: 40.4325, lng: -3.7009}), true, '170 m away');
  assert.equal(fuzzyMatch(a, {...a, title: 'Friday Lindy Social with live band', lat: 40.4360, lng: -3.7009}), false, '550 m away');
  assert.equal(fuzzyMatch(a, {...a, title: 'Friday Lindy Social with live band', lat: null, lng: null}), true, 'unknown place counts as near');
  assert.equal(fuzzyMatch(a, {...a, lat: 40.47, lng: -3.60, startsAt: new Date('2099-06-12T21:00:00Z')}), true, 'same title two hours later, elsewhere in town');
  assert.equal(fuzzyMatch(a, {...a, lat: 40.47, lng: -3.60, startsAt: new Date('2099-06-13T03:00:00Z')}), false, 'same title eight hours later, elsewhere');
  assert.equal(fuzzyMatch(a, {...a, title: 'Friday Lindy Social with live band', startsAt: new Date('2099-06-13T19:00:00Z')}), false, 'next day');
  assert.equal(fuzzyMatch(a, {...a, title: 'Tango marathon'}), false);
});
test('job schedule: due sources, quick retries after a failure, then back to the normal rhythm', () => {
  const now = new Date('2026-10-01T12:00:00Z'), ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const state = (value: object) => JSON.stringify(value);
  assert.equal(isDue({lastRunAt: null, lastStatus: null}, now, 6), true);
  assert.equal(isDue({lastRunAt: ago(60), lastStatus: state({ok: true})}, now, 6), false);
  assert.equal(isDue({lastRunAt: ago(360), lastStatus: state({ok: true})}, now, 6), true);
  assert.equal(isDue({lastRunAt: ago(10), lastStatus: state({ok: false, failures: 1})}, now, 6), false);
  assert.equal(isDue({lastRunAt: ago(30), lastStatus: state({ok: false, failures: 1})}, now, 6), true);
  assert.equal(isDue({lastRunAt: ago(30), lastStatus: state({ok: false, failures: 2})}, now, 6), false);
  assert.equal(isDue({lastRunAt: ago(60), lastStatus: state({ok: false, failures: 2})}, now, 6), true);
  assert.equal(isDue({lastRunAt: ago(120), lastStatus: state({ok: false, failures: 3})}, now, 6), false, 'three failures: no more quick retries');
  assert.equal(isDue({lastRunAt: ago(360), lastStatus: 'not json'}, now, 6), true);
  assert.deepEqual(importJobs.map(job => [job.name, job.everyMs ?? job.cron ?? null, job.attempts]),
    [['import.sources', 30 * 60_000, 3], ['import.source', null, 3], ['import.news.prune', '17 4 * * *', 3]]);
  assert.deepEqual(readState('{"ok":true,"etag":"x"}'), {ok: true, etag: 'x'});
  assert.deepEqual(readState('[1]'), {});
  assert.equal(secretMatches('abc', 'abc'), true);
  for (const [given, expected] of [['abc', 'abd'], ['', 'abc'], ['abc', ''], [null, 'abc'], ['abcd', 'abc']] as const) assert.equal(secretMatches(given, expected), false);
});
// ---------- pipeline against the database ----------
const zone = 'Europe/Madrid';
const base = DateTime.now().setZone(zone).plus({days: 10}).set({hour: 20, minute: 0, second: 0, millisecond: 0});
const cityName = 'Zyxport' + tag, cleanup = {sources: [] as string[], users: [] as string[], chats: [] as string[], cityId: ''};
const feedUrl = 'https://agenda-' + tag + '.example.org/events';
const realFetch = globalThis.fetch;
type BotCall = {method: string; payload: Record<string, unknown>};
const bot = {calls: [] as BotCall[], fail: null as null | ((call: BotCall) => {status: number; body: object} | null)};
const geocoder = {calls: 0};
// One stand-in for global fetch: the geocoder (Nominatim format) and the Telegram Bot API.
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'geocoder.test') {
    geocoder.calls++;
    const found = (url.searchParams.get('q') || '').includes('calle falsa');
    return Response.json(found ? [{lat: '12.3700', lon: '23.4800', display_name: 'Calle Falsa 123', address: {city: cityName, country_code: 'es'}}] : []);
  }
  if (url.hostname === 'api.telegram.org') {
    const call = {method: url.pathname.split('/').pop()!, payload: JSON.parse(String(init?.body || '{}'))};
    bot.calls.push(call);
    const failure = bot.fail?.(call);
    return failure ? Response.json(failure.body, {status: failure.status}) : Response.json({ok: true, result: {}});
  }
  throw new Error('unexpected network access in tests: ' + url.host);
}) as typeof fetch;
const jsonLd = (events: object[]) => '<html><head><script type="application/ld+json">' + JSON.stringify(events) + '</script></head></html>';
const place = (lat: number, lng: number, name = 'Club') => ({'@type': 'Place', name, geo: {'@type': 'GeoCoordinates', latitude: lat, longitude: lng}});
const feed = () => jsonLd([
  {'@type': 'DanceEvent', '@id': 'a', name: 'Fresh Blues Party & <b>Friends</b>', description: '<p>Come <i>early</i>.</p>', startDate: base.plus({days: 2}).toISO(),
    endDate: base.plus({days: 2, hours: 3}).toISO(), url: 'https://agenda-' + tag + '.example.org/fresh', location: place(12.36, 23.47, 'Blue Room')},
  {'@type': 'Event', '@id': 'b', name: 'Lindy Hop Social Night!', startDate: base.toISO(), location: place(12.35002, 23.46001)},
  {'@type': 'Event', '@id': 'c', name: 'Lindy Hop Social', startDate: base.plus({hours: 1}).toISO(), location: place(12.351, 23.461)},
  {'@type': 'Event', '@id': 'd', name: 'Old Party', startDate: '2001-01-05T20:00:00Z', location: place(12.36, 23.47)},
  {'@type': 'Event', '@id': 'e', name: 'No date at all', location: place(12.36, 23.47)},
  {'@type': 'Event', '@id': 'f', name: 'Shag Jam Session', startDate: base.plus({days: 3}).toISO(), location: {'@type': 'Place', name: 'Bar', address: 'Calle Falsa 123, ' + cityName}},
  {'@type': 'Event', '@id': 'g', name: 'Balboa Weekend Workshop', startDate: base.plus({days: 1, hours: 2}).toISO()},
  {'@type': 'Event', '@id': 'i', name: 'Floating Tango Evening', startDate: base.plus({days: 4}).set({hour: 21}).toFormat("yyyy-MM-dd'T'HH:mm")},
  {'@type': 'Event', '@id': 'j', name: 'fresh blues party, friends', startDate: base.plus({days: 2}).toISO(), location: place(12.36004, 23.47003)}
]);
const itemsOf = async (sourceId: string) => new Map((await db.importedItem.findMany({where: {sourceId}})).map(item => [item.externalId, item]));
const net = {requests: [] as {url: string; headers: Record<string, string>}[], notModified: false, down: false};
function useFeedTransport() {
  setImportNet({resolve: async () => PUBLIC, delayMs: 0, transport: async (url, options) => {
    net.requests.push({url: url.toString(), headers: options.headers});
    if (net.down) throw new ImportFetchError('NETWORK');
    if (url.pathname === '/news') return ok(fixture('news.rss.xml'));
    if (net.notModified && options.headers['If-None-Match'] === 'W/"feed-1"') return {status: 304, headers: {}, body: Buffer.alloc(0)};
    return ok(feed(), {etag: 'W/"feed-1"'});
  }});
}
after(async () => {
  globalThis.fetch = realFetch;
  setImportNet(null);
  const items = await db.importedItem.findMany({where: {sourceId: {in: cleanup.sources}}, select: {id: true}});
  await db.auditLog.deleteMany({where: {targetType: 'ImportedItem', targetId: {in: items.map(item => item.id)}}});
  await db.telegramChat.deleteMany({where: {chatId: {in: cleanup.chats}}});
  await db.verification.deleteMany({where: {value: {in: cleanup.users}}});
  await db.user.deleteMany({where: {id: {in: cleanup.users}}});
  await db.importSource.deleteMany({where: {id: {in: cleanup.sources}}});
  if (cleanup.cityId) {
    await db.event.deleteMany({where: {cityId: cleanup.cityId}});
    await db.city.deleteMany({where: {id: cleanup.cityId}});
  }
  await db.geocodeCache.deleteMany({where: {key: {contains: cityName.toLowerCase()}}});
  await closeRedis();
  await db.$disconnect();
});
let sourceId = '';
test('pipeline: imported, duplicate, review and rejected decisions; a second run changes nothing', async () => {
  const city = await db.city.create({data: {slug: 'zz-import-' + tag, name: cityName, countryCode: 'ES', timezone: zone, lat: 12.3456, lng: 23.4567}});
  cleanup.cityId = city.id;
  const siteEvent = (title: string, startsAt: Date, lat: number, lng: number) => db.event.create({data: {slug: 'event-' + randomUUID(), title, startsAt, timezone: zone,
    cityId: city.id, lat, lng, status: 'PUBLISHED', occurrences: {create: {startsAt}}}});
  const social = await siteEvent('Lindy Hop Social Night', base.toJSDate(), 12.35, 23.46);
  const workshop = await siteEvent('Balboa Weekend Workshop', base.plus({days: 1}).toJSDate(), city.lat, city.lng);
  const source = await db.importSource.create({data: {kind: 'SCHEMA_ORG', url: feedUrl, name: 'Test agenda ' + tag, cityId: city.id}});
  cleanup.sources.push(sourceId = source.id);
  useFeedTransport();
  const first = await runSource(source.id);
  assert.deepEqual(first, {sourceId: source.id, ok: true, notModified: false, counts: {IMPORTED: 3, DUPLICATE: 3, REVIEW: 1, REJECTED: 2}});
  const items = await itemsOf(source.id);
  assert.deepEqual(Object.fromEntries([...items].map(([id, item]) => [id, item.status + (item.status === 'REJECTED' ? ':' + item.note : '')]).sort()),
    {a: 'IMPORTED', b: 'DUPLICATE', c: 'REVIEW', d: 'REJECTED:PAST', e: 'REJECTED:NO_DATE', f: 'IMPORTED', g: 'DUPLICATE', i: 'IMPORTED', j: 'DUPLICATE'});
  // Imported: published, ownerless, linked to its source, plain text only.
  const fresh = await db.event.findUniqueOrThrow({where: {id: items.get('a')!.eventId!}, include: {occurrences: true, members: true}});
  assert.equal(fresh.title, 'Fresh Blues Party & Friends');
  assert.equal(fresh.description, 'Come early.\n\nBlue Room');
  assert.deepEqual([fresh.status, fresh.cityId, fresh.timezone, fresh.sourceUrl, fresh.rrule, fresh.kind], ['PUBLISHED', city.id, zone, 'https://agenda-' + tag + '.example.org/fresh', null, 'SOCIAL']);
  assert.deepEqual([fresh.lat, fresh.lng, fresh.members.length, fresh.occurrences.length], [12.36, 23.47, 0, 1]);
  assert.equal(fresh.startsAt.getTime(), base.plus({days: 2}).toMillis());
  assert.equal(fresh.endsAt?.getTime(), base.plus({days: 2, hours: 3}).toMillis());
  assert.equal(fresh.dedupeKey, base.plus({days: 2}).toFormat('yyyy-MM-dd') + '|12.360,23.470|blues fresh friends party');
  assert.equal(fresh.dedupeKey, items.get('a')!.dedupeKey);
  assert.match(fresh.shortCode || '', /^[a-z2-7]{6,8}$/);
  // Duplicates point at what they duplicate: an event made on the site (with and without a venue) and an item of the same feed.
  assert.equal(items.get('b')!.eventId, social.id);
  assert.equal(items.get('g')!.eventId, workshop.id);
  assert.equal(items.get('g')!.dedupeKey, base.plus({days: 1}).toFormat('yyyy-MM-dd') + '|city:' + city.id + '|balboa weekend workshop');
  assert.equal(items.get('j')!.eventId, fresh.id);
  assert.deepEqual([items.get('c')!.eventId, items.get('c')!.note], [social.id, 'SIMILAR_TO Lindy Hop Social Night']);
  // No coordinates in the feed: the address goes through the (cached) geocoder.
  const shag = await db.event.findUniqueOrThrow({where: {id: items.get('f')!.eventId!}});
  assert.deepEqual([shag.lat, shag.lng], [12.37, 23.48]);
  assert.equal(geocoder.calls, 1);
  // A wall-clock time without an offset is placed in the city's timezone.
  const floating = await db.event.findUniqueOrThrow({where: {id: items.get('i')!.eventId!}});
  assert.equal(floating.startsAt.getTime(), base.plus({days: 4}).set({hour: 21}).toMillis());
  assert.deepEqual([floating.lat, floating.lng], [city.lat, city.lng]);
  const state = readState((await db.importSource.findUniqueOrThrow({where: {id: source.id}})).lastStatus);
  assert.deepEqual([state.ok, state.http, state.etag, state.failures, state.counts?.IMPORTED], [true, 200, 'W/"feed-1"', 0, 3]);
  const events = await db.event.count({where: {cityId: city.id}});
  assert.equal(events, 5);
  const second = await runSource(source.id);
  assert.deepEqual(second.counts, {SKIPPED: 9});
  assert.equal(net.requests.at(-1)!.headers['If-None-Match'], 'W/"feed-1"', 'the stored ETag is sent back');
  net.notModified = true;
  const third = await runSource(source.id);
  assert.deepEqual([third.ok, third.notModified, third.counts], [true, true, {}]);
  assert.equal(await db.event.count({where: {cityId: city.id}}), events, 're-runs create nothing');
  assert.equal((await itemsOf(source.id)).size, 9);
  assert.equal(geocoder.calls, 1);
  assert.equal(readState((await db.importSource.findUniqueOrThrow({where: {id: source.id}})).lastStatus).counts?.SKIPPED, 9, 'a 304 keeps the counts of the last real run');
});
test('a failing or hostile source is isolated: no exception, status recorded, validators kept', async () => {
  net.down = true;
  const failed = await runSource(sourceId);
  assert.deepEqual([failed.ok, failed.error], [false, 'NETWORK']);
  const row = await db.importSource.findUniqueOrThrow({where: {id: sourceId}}), state = readState(row.lastStatus);
  assert.deepEqual([state.ok, state.failures, state.error, state.etag], [false, 1, 'NETWORK', 'W/"feed-1"']);
  assert.equal(isDue(row, new Date(row.lastRunAt!.getTime() + 31 * 60_000), 6), true);
  assert.equal(isDue(row, new Date(row.lastRunAt!.getTime() + 5 * 60_000), 6), false);
  await assert.rejects(importJobs[1].handler({sourceId}), /IMPORT_FAILED NETWORK/, 'the on-demand job fails so that the queue retries it');
  net.down = false;
  const local = await db.importSource.create({data: {kind: 'ICAL', url: 'http://169.254.169.254/' + tag + '/calendar.ics', name: 'Metadata ' + tag}});
  cleanup.sources.push(local.id);
  const before = net.requests.length;
  assert.deepEqual([(await runSource(local.id)).error, net.requests.length], ['PRIVATE_ADDRESS', before]);
  assert.deepEqual((await runSource('missing-' + tag)).skipped, 'NOT_FOUND');
  await db.importSource.update({where: {id: local.id}, data: {enabled: false}});
  assert.equal((await runSource(local.id)).skipped, 'DISABLED');
  assert.equal(readState((await db.importSource.findUniqueOrThrow({where: {id: sourceId}})).lastStatus).ok, false);
  assert.equal((await runSource(sourceId)).ok, true);
});
test('review: approval from the admin panel (PENDING + APPROVED), approveItem and rejectItem with an audit trail', async () => {
  const items = await itemsOf(sourceId), disputed = items.get('c')!, cityId = cleanup.cityId;
  const before = await db.event.count({where: {cityId}});
  // What apps/admin does on "approve".
  await db.importedItem.update({where: {id: disputed.id}, data: {status: 'PENDING', note: 'APPROVED'}});
  assert.deepEqual(await processApproved(new Date(), 100, sourceId), {IMPORTED: 1});
  const approved = await db.importedItem.findUniqueOrThrow({where: {id: disputed.id}, include: {event: true}});
  assert.deepEqual([approved.status, approved.note, approved.event?.title, approved.event?.status], ['IMPORTED', 'APPROVED', 'Lindy Hop Social', 'PUBLISHED']);
  assert.notEqual(approved.eventId, disputed.eventId, 'a new event, not the one it resembled');
  assert.equal(await db.event.count({where: {cityId}}), before + 1);
  assert.deepEqual(await processApproved(new Date(), 100, sourceId), {}, 'nothing left to do');
  // The same item still in the feed on the next run is not imported again.
  assert.deepEqual((await runSource(sourceId, {force: true})).counts, {SKIPPED: 9});
  assert.equal(await db.event.count({where: {cityId}}), before + 1);
  // An approved item that is still PENDING when its feed is fetched takes the same path.
  const payload = {...(items.get('a')!.payload as object), title: 'Hand Approved Jam', startsAt: base.plus({days: 6}).toUTC().toISO(), endsAt: null,
    occurrences: [{startsAt: base.plus({days: 6}).toUTC().toISO(), endsAt: null}]};
  const manual = await db.importedItem.create({data: {sourceId, externalId: 'manual-1', status: 'REVIEW', note: 'SIMILAR_TO x', payload}});
  const outcome = await approveItem(manual.id, 'staff-' + tag);
  assert.equal(outcome.status, 'IMPORTED');
  const created = await db.event.findUniqueOrThrow({where: {id: outcome.eventId!}, include: {occurrences: true}});
  assert.deepEqual([created.title, created.occurrences.length, created.sourceUrl], ['Hand Approved Jam', 1, 'https://agenda-' + tag + '.example.org/fresh']);
  const audit = await db.auditLog.findMany({where: {targetType: 'ImportedItem', targetId: manual.id}});
  assert.deepEqual(audit.map(row => [row.actorUserId, row.action, (row.data as {eventId?: string}).eventId]), [['staff-' + tag, 'IMPORT_APPROVE', created.id]]);
  await assert.rejects(approveItem(manual.id, 'staff-' + tag), (error: unknown) => error instanceof ReviewError && error.code === 'ALREADY_DECIDED' && error.status === 409);
  await assert.rejects(approveItem('missing-' + tag, 'staff-' + tag), (error: unknown) => error instanceof ReviewError && error.status === 404);
  // A date that passed while the item waited for review is not published.
  const stale = await db.importedItem.create({data: {sourceId, externalId: 'manual-2', status: 'REVIEW', payload: {...payload, startsAt: '2001-01-01T10:00:00.000Z',
    occurrences: [{startsAt: '2001-01-01T10:00:00.000Z', endsAt: null}]}}});
  assert.deepEqual(await approveItem(stale.id, 'staff-' + tag), {status: 'REJECTED', eventId: null, note: 'PAST'});
  const unwanted = await db.importedItem.create({data: {sourceId, externalId: 'manual-3', status: 'REVIEW', payload}});
  assert.deepEqual(await rejectItem(unwanted.id, 'staff-' + tag, ' not a dance event '), {status: 'REJECTED', eventId: null, note: 'not a dance event'});
  const rejected = await db.importedItem.findUniqueOrThrow({where: {id: unwanted.id}});
  assert.deepEqual([rejected.status, rejected.note, rejected.eventId], ['REJECTED', 'not a dance event', null]);
  assert.equal(await db.auditLog.count({where: {targetType: 'ImportedItem', targetId: unwanted.id, action: 'IMPORT_REJECT', actorUserId: 'staff-' + tag}}), 1);
  await assert.rejects(rejectItem(unwanted.id, 'staff-' + tag), (error: unknown) => error instanceof ReviewError && error.code === 'ALREADY_DECIDED');
});
test('news sources fill NewsItem once and old news is pruned', async () => {
  const source = await db.importSource.create({data: {kind: 'RSS', news: true, url: 'https://news-' + tag + '.example.org/news', name: 'News ' + tag, cityId: cleanup.cityId}});
  cleanup.sources.push(source.id);
  // NewsItem.url is unique across sources: make sure an earlier aborted run left nothing behind.
  await db.newsItem.deleteMany({where: {url: {startsWith: 'https://news.example.org/'}}});
  assert.deepEqual((await runSource(source.id)).counts, {NEWS: 4, SKIPPED: 0});
  const news = await db.newsItem.findMany({where: {sourceId: source.id}, orderBy: {publishedAt: 'asc'}});
  assert.deepEqual([news[0].title, news[0].summary, news[0].cityId, news[0].url], ['Herrang announces 2027 dates', 'The camp returns next summer.', cleanup.cityId, 'https://news.example.org/herrang-2027']);
  assert.equal(news.some(item => /[<>]/.test(item.title + (item.summary || ''))), false);
  assert.deepEqual((await runSource(source.id, {force: true})).counts, {NEWS: 0, SKIPPED: 4});
  assert.equal(await db.newsItem.count({where: {sourceId: source.id}}), 4);
  assert.equal(await db.importedItem.count({where: {sourceId: source.id}}), 0, 'news never become events');
  assert.deepEqual(await pruneNews(new Date('2026-12-01T00:00:00Z'), source.id), {deleted: 0});
  assert.deepEqual(await pruneNews(new Date(Date.now() + 200 * 86400_000), source.id), {deleted: 4});
});
test('POST /api/import/run exists only with CRON_SECRET and checks the bearer token', async () => {
  const {POST} = await import('../src/app/api/import/run/route');
  const call = (token?: string, body: object = {}) => POST(new Request('http://localhost/api/import/run', {method: 'POST', body: JSON.stringify(body),
    headers: token ? {authorization: 'Bearer ' + token} : {}}));
  const saved = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await call('anything')).status, 404);
    process.env.CRON_SECRET = 'cron-' + tag;
    assert.equal((await call()).status, 401);
    assert.equal((await call('cron-' + tag + 'x')).status, 401);
    assert.equal((await call('cron-' + tag, {sourceId: 'missing-' + tag})).status, 404);
    assert.equal((await call('cron-' + tag, {sourceId: 5})).status, 400);
    net.notModified = true;
    const response = await call('cron-' + tag, {sourceId});
    assert.deepEqual([response.status, (await response.json()).ok], [200, true]);
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  }
});
// ---------- Telegram ----------
// ---------- imported events follow their source ----------
const syncEvents = () => db.event.findMany({where: {cityId: cleanup.cityId, sourceUrl: {startsWith: 'https://sync-' + tag}}, orderBy: {createdAt: 'asc'}, include: {occurrences: {orderBy: {startsAt: 'asc'}}, members: true}});
test('imported events follow their source until a person takes over; cancelled and vanished entries cancel the event', async () => {
  const origin = 'https://sync-' + tag + '.example.org', when = (days: number, hours = 0) => base.plus({days, hours}).toISO();
  const entry = (id: string, name: string, startDate: string | null, extra: object = {}) => ({'@type': 'DanceEvent', '@id': id, name: name + ' ' + tag, startDate, url: origin + '/' + id, location: place(12.4, 23.5, 'Hall'), ...extra});
  let listing = [entry('s1', 'Zouk Marathon', when(5), {description: 'Three rooms.'}), entry('s2', 'Kizomba Lake Party', when(6)), entry('s3', 'Forro Picnic', when(7)), entry('s4', 'Bachata Rooftop', when(8))];
  setImportNet({resolve: async () => PUBLIC, delayMs: 0, transport: async () => ok(jsonLd(listing))});
  clearRobotsMemory();
  const source = await db.importSource.create({data: {kind: 'SCHEMA_ORG', url: origin + '/agenda', name: 'Sync ' + tag, cityId: cleanup.cityId}});
  cleanup.sources.push(source.id);
  const run = async () => (await runSource(source.id, {force: true})).counts;
  const userId = 'sync-' + tag, saved = process.env.IMPORT_MISSING_RUNS;
  try {
    assert.deepEqual(await run(), {IMPORTED: 4});
    const first = await itemsOf(source.id), [e1, e2, e3, e4] = ['s1', 's2', 's3', 's4'].map(id => first.get(id)!.eventId!);
    // The item remembers what it wrote and when: the event's updatedAt after the importer's last write.
    const before = await db.event.findUniqueOrThrow({where: {id: e1}});
    assert.deepEqual(readSync(first.get('s1')!.payload), {hash: contentHash(first.get('s1')!.payload as Payload), writtenAt: before.updatedAt.toISOString()});
    assert.match(before.shortCode || '', /^[a-z2-7]{6,8}$/);
    assert.deepEqual(await run(), {SKIPPED: 4}, 'an unchanged feed writes nothing');
    assert.equal((await db.event.findUniqueOrThrow({where: {id: e1}})).updatedAt.getTime(), before.updatedAt.getTime());
    assert.deepEqual((await itemsOf(source.id)).get('s1')!.payload, first.get('s1')!.payload);
    // People arrive: somebody plans to come to s4, an organizer claims s2, a moderator fixes the title of s3.
    await db.user.create({data: {id: userId, name: 'Sync Guest', email: 'sync-' + tag + '@example.test', emailVerified: true, locale: 'en', notificationPreference: {create: {emailEvents: false}}}});
    cleanup.users.push(userId);
    const guest = await db.profile.create({data: {userId, type: 'DANCER', handle: 'sync-' + tag, name: 'Sync Guest', cityId: cleanup.cityId}});
    await db.rsvp.createMany({data: [e1, e4].map(eventId => ({eventId, profileId: guest.id, status: 'GOING' as const}))});
    await db.eventMembership.create({data: {eventId: e2, profileId: guest.id, role: 'OWNER'}});
    await db.event.update({where: {id: e3}, data: {title: 'Forró Picnic (bring a blanket)'}});
    // The source changes everything about s1, the title of s2, the time of s3, and cancels s4.
    listing = [entry('s1', 'Zouk Marathon Deluxe', when(5, 1), {description: 'Four rooms now.', endDate: when(5, 5), location: place(12.41, 23.51, 'Bigger Hall')}),
      entry('s2', 'Kizomba Lake Night', when(6)), entry('s3', 'Forro Picnic', when(7, 2)), entry('s4', 'Bachata Rooftop', when(8), {eventStatus: 'https://schema.org/EventCancelled'})];
    assert.deepEqual(await run(), {UPDATED: 1, REVIEW: 2, CANCELLED: 1});
    const second = await itemsOf(source.id), events = new Map((await syncEvents()).map(event => [event.id, event]));
    assert.equal(events.size, 4, 'no event was created or removed');
    const changed = events.get(e1)!;
    assert.deepEqual([changed.title, changed.description, changed.lat, changed.lng, changed.status, changed.shortCode], ['Zouk Marathon Deluxe ' + tag, 'Four rooms now.\n\nBigger Hall', 12.41, 23.51, 'PUBLISHED', before.shortCode]);
    assert.deepEqual(changed.occurrences.map(date => [date.startsAt.getTime(), date.endsAt?.getTime()]), [[base.plus({days: 5, hours: 1}).toMillis(), base.plus({days: 5, hours: 5}).toMillis()]]);
    assert.equal(changed.startsAt.getTime(), base.plus({days: 5, hours: 1}).toMillis());
    assert.deepEqual([second.get('s1')!.status, second.get('s1')!.eventId, second.get('s1')!.dedupeKey], ['IMPORTED', e1, changed.dedupeKey]);
    assert.deepEqual(readSync(second.get('s1')!.payload), {hash: contentHash(second.get('s1')!.payload as Payload), writtenAt: changed.updatedAt.toISOString()});
    assert.equal(await db.rsvp.count({where: {eventId: e1}}), 1, 'answers survive an update');
    // Claimed or edited by a person: never overwritten, the difference waits for a reviewer.
    assert.deepEqual([events.get(e2)!.title, events.get(e3)!.title, events.get(e3)!.startsAt.getTime()], ['Kizomba Lake Party ' + tag, 'Forró Picnic (bring a blanket)', base.plus({days: 7}).toMillis()]);
    assert.deepEqual([second.get('s2')!.status, second.get('s2')!.note, second.get('s2')!.eventId], ['REVIEW', 'SOURCE_CHANGED title: "Kizomba Lake Party ' + tag + '" → "Kizomba Lake Night ' + tag + '"', e2]);
    assert.equal(second.get('s3')!.status, 'REVIEW');
    assert.match(second.get('s3')!.note || '', /^SOURCE_CHANGED time: \d{4}-.+ → \d{4}-/);
    assert.equal(readSync(second.get('s2')!.payload).pending, 'UPDATE');
    // Cancelled at the source: cancelled here, and the guest is told once.
    assert.deepEqual([events.get(e4)!.status, second.get('s4')!.status, second.get('s4')!.note, second.get('s4')!.eventId], ['CANCELLED', 'REJECTED', 'CANCELLED', e4]);
    const notices = () => db.notification.findMany({where: {userId, type: 'EVENT_CANCELLED'}, orderBy: {createdAt: 'asc'}});
    assert.deepEqual((await notices()).map(notice => (notice.data as {eventId?: string}).eventId), [e4]);
    assert.deepEqual(await run(), {SKIPPED: 4}, 'the same feed again changes nothing');
    assert.equal((await notices()).length, 1);
    assert.equal((await db.event.findUniqueOrThrow({where: {id: e1}})).updatedAt.getTime(), changed.updatedAt.getTime());
    // A reviewer accepts the source's version of the claimed event: it is applied to that event, no second one appears.
    const outcome = await approveItem(second.get('s2')!.id, 'staff-' + tag);
    assert.deepEqual([outcome.status, outcome.eventId], ['IMPORTED', e2]);
    assert.equal((await db.event.findUniqueOrThrow({where: {id: e2}})).title, 'Kizomba Lake Night ' + tag);
    assert.equal((await syncEvents()).length, 4);
    // s1 (untouched) and s2 (claimed) vanish from the page. Two runs only count; the third acts.
    process.env.IMPORT_MISSING_RUNS = '3';
    listing = listing.slice(2);
    assert.deepEqual(await run(), {SKIPPED: 2, MISSING: 2});
    assert.deepEqual([(await db.event.findUniqueOrThrow({where: {id: e1}})).status, readSync((await itemsOf(source.id)).get('s1')!.payload).missing], ['PUBLISHED', 1]);
    assert.deepEqual(await run(), {SKIPPED: 2, MISSING: 2});
    // An empty page, a failed fetch or "not modified" is not evidence that anything is gone.
    const full = listing;
    listing = [];
    assert.deepEqual(await run(), {});
    listing = full;
    assert.deepEqual(await run(), {SKIPPED: 2, CANCELLED: 1, REVIEW: 1});
    const last = await itemsOf(source.id);
    assert.deepEqual([(await db.event.findUniqueOrThrow({where: {id: e1}})).status, last.get('s1')!.status, last.get('s1')!.note], ['CANCELLED', 'REJECTED', 'GONE_FROM_SOURCE']);
    assert.deepEqual([(await db.event.findUniqueOrThrow({where: {id: e2}})).status, last.get('s2')!.status, last.get('s2')!.note, readSync(last.get('s2')!.payload).pending], ['PUBLISHED', 'REVIEW', 'SOURCE_GONE', 'CANCEL']);
    assert.deepEqual((await notices()).map(notice => (notice.data as {eventId?: string}).eventId), [e4, e1]);
    assert.deepEqual(await run(), {SKIPPED: 2});
    assert.equal((await notices()).length, 2);
    // An entry that reappears before the limit starts counting from zero again.
    const again = await db.importedItem.update({where: {id: last.get('s3')!.id}, data: {status: 'IMPORTED', payload: {...(last.get('s3')!.payload as object), sync: {missing: 2}}}});
    assert.equal(readSync(again.payload).missing, 2);
    await db.event.update({where: {id: e3}, data: {startsAt: base.plus({days: 7, hours: 2}).toJSDate(), title: 'Forro Picnic ' + tag, occurrences: {deleteMany: {}, create: {startsAt: base.plus({days: 7, hours: 2}).toJSDate()}}}});
    await run();
    assert.equal(readSync((await itemsOf(source.id)).get('s3')!.payload).missing, undefined);
  } finally {
    if (saved === undefined) delete process.env.IMPORT_MISSING_RUNS; else process.env.IMPORT_MISSING_RUNS = saved;
    clearRobotsMemory();
    useFeedTransport();
  }
});
test('change detection ignores what time does by itself: dates that pass and a weekly series rolling forward', () => {
  const now = new Date('2031-05-05T12:00:00Z');
  const single: Payload = {title: 'Jam', description: null, startsAt: '2031-05-10T18:00:00.000Z', endsAt: null, timezone: zone, cityId: 'c', venueName: 'Hall', address: null, lat: 1, lng: 2,
    precise: true, url: null, rrule: null, sourceRrule: null, allDay: false, occurrences: [{startsAt: '2031-05-01T18:00:00.000Z', endsAt: null}, {startsAt: '2031-05-10T18:00:00.000Z', endsAt: null}]};
  const later = {...single, occurrences: single.occurrences.slice(1)};
  assert.equal(contentHash(single), contentHash(later));
  assert.equal(futureDates(single, now), futureDates(later, now), 'a date that already passed is not a change');
  assert.notEqual(futureDates(single, now), futureDates({...later, occurrences: [{startsAt: '2031-05-10T19:00:00.000Z', endsAt: null}]}, now));
  assert.notEqual(contentHash(single), contentHash({...single, title: 'Jam!'}));
  assert.notEqual(contentHash(single), contentHash({...single, venueName: 'Other hall'}));
  // Weekly: next week's payload starts a week later and has one date fewer — the same series.
  const weekly: Payload = {...single, rrule: 'FREQ=WEEKLY;COUNT=10;BYDAY=SA', sourceRrule: 'FREQ=WEEKLY;BYDAY=SA', startsAt: '2031-05-10T18:00:00.000Z', endsAt: '2031-05-10T20:00:00.000Z', occurrences: []};
  const rolled = {...weekly, rrule: 'FREQ=WEEKLY;COUNT=9;BYDAY=SA', startsAt: '2031-05-17T18:00:00.000Z', endsAt: '2031-05-17T20:00:00.000Z'};
  assert.equal(contentHash(weekly), contentHash(rolled));
  assert.equal(futureDates(weekly, now), futureDates(rolled, now));
  // Across the change to winter time the local hour stays, although the UTC hour moves.
  assert.equal(contentHash(weekly), contentHash({...weekly, startsAt: '2031-11-01T19:00:00.000Z', endsAt: '2031-11-01T21:00:00.000Z'}));
  assert.notEqual(contentHash(weekly), contentHash({...rolled, startsAt: '2031-05-17T19:00:00.000Z', endsAt: '2031-05-17T21:00:00.000Z'}), 'an hour later is a change');
  assert.notEqual(contentHash(weekly), contentHash({...rolled, sourceRrule: 'FREQ=WEEKLY;BYDAY=SU'}));
  assert.equal(describeChange(single, {...single, title: 'Jam night', description: 'New text'}, now), 'SOURCE_CHANGED title: "Jam" → "Jam night"; description');
  assert.deepEqual(readSync({sync: {hash: 'h', writtenAt: 't', missing: 0, pending: 'DROP', other: 1}}), {hash: 'h', writtenAt: 't'});
  assert.deepEqual(readSync(null), {});
});
const messageKeys = (locale: string) => JSON.parse(readFileSync(new URL('../src/lib/telegram/messages/' + locale + '.json', import.meta.url), 'utf8')) as Record<string, string>;
test('bot messages: en, es and ru have the same keys and placeholders', () => {
  const [en, es, ru] = ['en', 'es', 'ru'].map(messageKeys), placeholders = (value: string) => (value.match(/\{\w+\}/g) || []).sort().join();
  assert.ok(Object.keys(en).length >= 30);
  for (const catalogue of [es, ru]) {
    assert.deepEqual(Object.keys(catalogue).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(catalogue)) {
      assert.ok(value.trim().length > 0, key);
      assert.equal(placeholders(value), placeholders(en[key]), key);
    }
  }
});
test('bot helpers: escaping, fuzzy city match, today and weekend ranges', () => {
  assert.equal(esc('<b>Tom & "Jerry"</b>'), '&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;');
  const cities = [{name: 'Madrid', slug: 'madrid'}, {name: 'Bogotá', slug: 'bogota'}, {name: 'Москва', slug: 'moscow'}, {name: 'Saint Petersburg', slug: 'saint-petersburg'}];
  for (const [query, slug] of [['madrid', 'madrid'], ['MADRID', 'madrid'], ['Madird', 'madrid'], ['bogota', 'bogota'], ['Bogotá', 'bogota'], ['moscow', 'moscow'],
    ['моск', 'moscow'], ['petersburg', 'saint-petersburg'], ['saint petersbourg', 'saint-petersburg']]) assert.equal(fuzzyPick(cities, query)?.slug, slug, query);
  for (const query of ['', 'xyz', 'paris', 'mad rid of it']) assert.equal(fuzzyPick(cities, query), null, query);
  // Wednesday 30 Sep 2026, 12:00 in Madrid.
  const wednesday = new Date('2026-09-30T10:00:00Z');
  assert.deepEqual(range('today', zone, wednesday), {from: wednesday, to: new Date('2026-09-30T21:59:59.999Z')});
  assert.deepEqual(range('weekend', zone, wednesday), {from: new Date('2026-10-02T16:00:00.000Z'), to: new Date('2026-10-04T21:59:59.999Z')});
  const saturday = new Date('2026-10-03T20:00:00Z');
  assert.deepEqual(range('weekend', zone, saturday), {from: saturday, to: new Date('2026-10-04T21:59:59.999Z')});
  assert.deepEqual(range('events', zone, wednesday), {from: wednesday});
});
const chatId = Number('7' + String(Date.now()).slice(-9)), groupId = -chatId;
const update = (text: string, chat = chatId, type = 'private', language = 'es') => ({update_id: 1, message: {message_id: 1, date: 0, chat: {id: chat, type}, from: {id: chat, language_code: language}, text}});
const lastText = () => String(bot.calls.filter(call => call.method === 'sendMessage').at(-1)?.payload.text ?? '');
const withBot = async (run: () => Promise<void>) => {
  const saved = {token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET, username: process.env.TELEGRAM_BOT_USERNAME, api: process.env.TELEGRAM_API_URL};
  Object.assign(process.env, {TELEGRAM_BOT_TOKEN: '123:test-' + tag, TELEGRAM_WEBHOOK_SECRET: 'hook-' + tag, TELEGRAM_BOT_USERNAME: 'dance_test_bot'});
  delete process.env.TELEGRAM_API_URL;
  cleanup.chats.push(String(chatId), String(groupId));
  try {await run();} finally {
    for (const [name, value] of [['TELEGRAM_BOT_TOKEN', saved.token], ['TELEGRAM_WEBHOOK_SECRET', saved.secret], ['TELEGRAM_BOT_USERNAME', saved.username], ['TELEGRAM_API_URL', saved.api]] as const)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    bot.fail = null;
  }
};
test('bot commands: search without an account, city, language, paging and escaped output', () => withBot(async () => {
  const messages = {en: messageKeys('en'), es: messageKeys('es'), ru: messageKeys('ru')};
  assert.equal(await handleUpdate(update('hello there')), 'ignored', 'plain text is not a command');
  assert.equal(await handleUpdate({nonsense: true}), 'ignored');
  assert.equal(bot.calls.length, 0);
  assert.equal(await handleUpdate(update('/start')), 'answered');
  const call = bot.calls.at(-1)!;
  assert.deepEqual([call.method, call.payload.chat_id, call.payload.parse_mode], ['sendMessage', String(chatId), 'HTML']);
  assert.equal(call.payload.text, esc(messages.es.start), 'the first language comes from the Telegram client');
  assert.deepEqual(await db.telegramChat.findUnique({where: {chatId: String(chatId)}, select: {locale: true, cityId: true, userId: true, notify: true}}),
    {locale: 'es', cityId: null, userId: null, notify: false});
  await handleUpdate(update('/help@dance_test_bot'));
  assert.equal(lastText(), esc(messages.es.help));
  assert.ok(lastText().includes('/search &lt;texto&gt;') && !lastText().includes('<texto>'), 'angle brackets of the help text are escaped');
  await handleUpdate(update('/frobnicate'));
  assert.equal(lastText(), esc(messages.es.unknown));
  // City: typo-tolerant, accent-insensitive; unknown names change nothing.
  await handleUpdate(update('/city'));
  assert.equal(lastText(), esc(messages.es.cityUsage));
  await handleUpdate(update('/city <b>Atlantis</b>'));
  assert.ok(lastText().includes('&lt;b&gt;Atlantis&lt;/b&gt;') && !lastText().includes('<b>Atlantis'));
  assert.equal((await db.telegramChat.findUniqueOrThrow({where: {chatId: String(chatId)}})).cityId, null);
  await handleUpdate(update('/city ' + cityName.toUpperCase().replace('P', 'B')));
  assert.equal(lastText(), esc(messages.es.citySet.replace('{city}', cityName)));
  assert.equal((await db.telegramChat.findUniqueOrThrow({where: {chatId: String(chatId)}})).cityId, cleanup.cityId);
  // Events of the city: five per message, a "more" button, links into the site in the chat's language.
  await db.event.create({data: {slug: 'event-' + randomUUID(), title: 'Rock <b>&</b> "Roll" ' + tag, startsAt: base.minus({days: 3}).toJSDate(), timezone: zone, cityId: cleanup.cityId,
    lat: 12.3, lng: 23.4, status: 'PUBLISHED', occurrences: {create: {startsAt: base.minus({days: 3}).toJSDate()}}}});
  await db.event.create({data: {slug: 'event-' + randomUUID(), title: 'Hidden draft ' + tag, startsAt: base.minus({days: 4}).toJSDate(), timezone: zone, cityId: cleanup.cityId,
    status: 'DRAFT', occurrences: {create: {startsAt: base.minus({days: 4}).toJSDate()}}}});
  await handleUpdate(update('/events'));
  const list = bot.calls.at(-1)!, text = String(list.payload.text);
  assert.ok(text.startsWith('<b>' + esc(messages.es.eventsTitle.replace('{city}', cityName)) + '</b>'));
  assert.ok(text.includes('<b>Rock &lt;b&gt;&amp;&lt;/b&gt; &quot;Roll&quot; ' + tag + '</b>'), 'titles are escaped');
  assert.equal(text.includes('Hidden draft'), false);
  assert.equal((text.match(/<a href="/g) || []).length, 5);
  const fresh = await db.event.findFirstOrThrow({where: {cityId: cleanup.cityId, title: 'Lindy Hop Social Night'}});
  assert.ok(text.includes('<a href="' + siteUrl() + '/es/events/' + fresh.slug + '">' + messages.es.open + '</a>'));
  assert.deepEqual(list.payload.reply_markup, {inline_keyboard: [[{text: messages.es.more, callback_data: 'm|events|2|'}]]});
  assert.deepEqual(list.payload.link_preview_options, {is_disabled: true});
  // The button and "/events 2" give the same second page.
  assert.equal(await handleUpdate({update_id: 2, callback_query: {id: 'cb1', data: 'm|events|2|', message: {message_id: 5, chat: {id: chatId, type: 'private'}}}}), 'answered');
  assert.ok(bot.calls.some(entry => entry.method === 'answerCallbackQuery' && entry.payload.callback_query_id === 'cb1'));
  const second = lastText();
  assert.ok(second.includes(messages.es.page.replace('{page}', '2')) && second.includes('Hand Approved Jam') && !second.includes('Rock'));
  await handleUpdate(update('/events 2'));
  assert.equal(lastText(), second);
  assert.equal(await handleUpdate({update_id: 3, callback_query: {id: 'cb2', data: 'x|drop table', message: {chat: {id: chatId}}}}), 'ignored');
  await handleUpdate(update('/search tango <b>'));
  assert.ok(lastText().includes(esc(messages.es.noEvents)) && lastText().includes('tango &lt;b&gt;') && !lastText().includes('<b>tango'));
  await handleUpdate(update('/search ROCK'));
  assert.ok(lastText().includes('&quot;Roll&quot; ' + tag) && (lastText().match(/<a href="/g) || []).length === 1);
  await handleUpdate(update('/search'));
  assert.equal(lastText(), esc(messages.es.searchUsage));
  await handleUpdate(update('/style no-such-style-' + tag));
  assert.equal(lastText(), esc(messages.es.styleNotFound.replace('{query}', 'no-such-style-' + tag)));
  await handleUpdate(update('/today'));
  assert.ok(lastText().startsWith('<b>' + esc(messages.es.todayTitle.replace('{city}', cityName))));
  await handleUpdate(update('/weekend'));
  assert.ok(lastText().startsWith('<b>' + esc(messages.es.weekendTitle.replace('{city}', cityName))));
  await handleUpdate(update('/lang ru'));
  assert.equal(lastText(), esc(messages.ru.langSet));
  await handleUpdate(update('/lang de'));
  assert.equal(lastText(), esc(messages.ru.langUsage));
  await handleUpdate(update('/events'));
  assert.ok(lastText().includes(siteUrl() + '/ru/events/'));
  await handleUpdate(update('/notify on'));
  assert.equal(lastText(), esc(messages.ru.notifyNeedsLink), 'notifications need a connected account');
  assert.equal((await db.telegramChat.findUniqueOrThrow({where: {chatId: String(chatId)}})).notify, false);
  // A blocked bot does not break the webhook.
  bot.fail = () => ({status: 403, body: {ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user'}});
  assert.equal(await handleUpdate(update('/help')), 'failed');
  bot.fail = null;
}));
test('account linking: one-time token, expiry, notifications to the linked chat, unlink and /stop', () => withBot(async () => {
  const messages = messageKeys('ru'), userId = 'tg-user-' + tag;
  cleanup.users.push(userId);
  await db.user.create({data: {id: userId, name: 'Telegram Tester', email: 'tg-' + tag + '@example.test', emailVerified: true, locale: 'ru'}});
  const first = await createLinkToken(userId);
  assert.ok(first);
  assert.match(first.url, /^https:\/\/t\.me\/dance_test_bot\?start=[A-Za-z0-9_-]{43}$/);
  assert.ok(first.expiresAt.getTime() - Date.now() <= 10 * 60_000 && first.expiresAt.getTime() - Date.now() > 9 * 60_000);
  const stored = await db.verification.findMany({where: {value: userId}});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].identifier.includes(first.token), false, 'only a hash of the token is stored');
  // A new token replaces the previous one.
  const link = await createLinkToken(userId);
  assert.ok(link);
  assert.equal(await db.verification.count({where: {value: userId}}), 1);
  await handleUpdate(update('/start ' + first.token));
  assert.equal(lastText(), esc(messages.linkInvalid));
  await handleUpdate(update('/start ' + link.token, groupId, 'supergroup'));
  assert.equal(lastText().length > 0 && (await db.telegramChat.findUnique({where: {chatId: String(groupId)}}))?.userId, null, 'a group cannot be linked');
  await handleUpdate(update('/start not-a-token'));
  assert.equal(lastText(), esc(messages.linkInvalid));
  await handleUpdate(update('/start ' + link.token));
  assert.equal(lastText(), esc(messages.linked));
  assert.deepEqual(await db.telegramChat.findUnique({where: {chatId: String(chatId)}, select: {userId: true, notify: true}}), {userId, notify: true});
  assert.equal(await db.verification.count({where: {value: userId}}), 0);
  await handleUpdate(update('/start ' + link.token));
  assert.equal(lastText(), esc(messages.linkInvalid), 'a token works once');
  const expired = await createLinkToken(userId);
  await db.verification.updateMany({where: {value: userId}, data: {expiresAt: new Date(Date.now() - 1000)}});
  await db.telegramChat.update({where: {chatId: String(chatId)}, data: {userId: null, notify: false}});
  await handleUpdate(update('/start ' + expired!.token));
  assert.equal(lastText(), esc(messages.linkInvalid), 'an expired token is refused');
  assert.equal((await db.telegramChat.findUniqueOrThrow({where: {chatId: String(chatId)}})).userId, null);
  const again = await createLinkToken(userId);
  await handleUpdate(update('/start ' + again!.token));
  assert.equal(lastText(), esc(messages.linked));
  // Delivery: localized, escaped, with a link in the chat's language; other notification types stay on the site.
  bot.calls.length = 0;
  await telegramDelivery(userId, 'EVENT_REMINDER', {title: 'Swing <Night> & Co', startsAt: base.toUTC().toISO(), timezone: zone, place: 'Sala "X"'}, '/events/some-slug');
  assert.equal(bot.calls.length, 1);
  const sent = String(bot.calls[0].payload.text);
  assert.equal(bot.calls[0].payload.chat_id, String(chatId));
  assert.ok(sent.includes('Swing &lt;Night&gt; &amp; Co') && sent.includes('Sala &quot;X&quot;') && !sent.includes('<Night>'));
  assert.ok(sent.endsWith('<a href="' + siteUrl() + '/ru/events/some-slug">' + messages.notificationLink + '</a>'));
  await telegramDelivery(userId, 'NEW_FOLLOWER', {name: 'x'}, '/people/x');
  await telegramDelivery('nobody-' + tag, 'CHAT_MESSAGE', {senderName: 'x', preview: 'hi'}, '/messages/1');
  assert.equal(bot.calls.length, 1);
  for (const type of ['EVENT_CANCELLED', 'PARTNER_MATCH', 'CHAT_MESSAGE']) await telegramDelivery(userId, type, {title: 'T', name: 'N', senderName: 'S', preview: '<i>hi</i>'}, '/x');
  assert.equal(bot.calls.length, 4);
  assert.ok(String(bot.calls[3].payload.text).includes('&lt;i&gt;hi&lt;/i&gt;'));
  // /notify off and on.
  await handleUpdate(update('/notify off'));
  assert.equal(lastText(), esc(messages.notifyOff));
  bot.calls.length = 0;
  await telegramDelivery(userId, 'EVENT_REMINDER', {title: 'x'}, '/x');
  assert.equal(bot.calls.length, 0);
  await handleUpdate(update('/notify on'));
  assert.equal(lastText(), esc(messages.notifyOn));
  // Telegram rate limit: one retry after the pause it asks for.
  let attempts = 0;
  bot.fail = () => attempts++ === 0 ? {status: 429, body: {ok: false, error_code: 429, description: 'Too Many Requests', parameters: {retry_after: 0}}} : null;
  bot.calls.length = 0;
  await telegramDelivery(userId, 'EVENT_REMINDER', {title: 'retry'}, '/x');
  assert.equal(bot.calls.length, 2);
  // "bot was blocked by the user" turns notifications off instead of failing every time.
  bot.fail = () => ({status: 403, body: {ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user'}});
  await telegramDelivery(userId, 'EVENT_REMINDER', {title: 'blocked'}, '/x');
  assert.equal((await db.telegramChat.findUniqueOrThrow({where: {chatId: String(chatId)}})).notify, false);
  bot.fail = null;
  bot.calls.length = 0;
  await telegramDelivery(userId, 'EVENT_REMINDER', {title: 'after block'}, '/x');
  assert.equal(bot.calls.length, 0);
  // Unlink from the site, then forget the chat from Telegram.
  const {unlinkUser, linkStatus} = await import('../src/lib/telegram/link');
  assert.deepEqual(await linkStatus(userId), {linked: true, notify: false});
  assert.equal(await unlinkUser(userId), 1);
  assert.deepEqual(await linkStatus(userId), {linked: false, notify: false});
  await handleUpdate(update('/stop'));
  assert.equal(lastText(), esc(messages.stopped));
  assert.equal(await db.telegramChat.findUnique({where: {chatId: String(chatId)}}), null);
}));
test('webhook: 404 without a bot token, 401 without the right secret, 200 otherwise', async () => {
  const {POST} = await import('../src/app/api/telegram/webhook/route');
  const hookChat = chatId + 1;
  cleanup.chats.push(String(hookChat));
  const call = (secret: string | null, body: unknown = update('/help', hookChat, 'private', 'en')) => POST(new Request('http://localhost/api/telegram/webhook', {method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body), headers: secret === null ? {} : {'x-telegram-bot-api-secret-token': secret}}));
  const savedToken = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    assert.equal((await call('hook-' + tag)).status, 404);
  } finally {
    if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
  }
  await withBot(async () => {
    bot.calls.length = 0;
    for (const secret of [null, '', 'wrong', 'hook-' + tag + 'x']) assert.equal((await call(secret)).status, 401, String(secret));
    assert.equal(bot.calls.length, 0, 'nothing is processed without the secret');
    process.env.TELEGRAM_WEBHOOK_SECRET = '';
    assert.equal((await call('')).status, 401, 'a missing secret never means "open"');
    process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-' + tag;
    const response = await call('hook-' + tag);
    assert.deepEqual([response.status, await response.json()], [200, {ok: true}]);
    assert.equal(lastText(), esc(messageKeys('en').help));
    assert.equal((await call('hook-' + tag, 'not json')).status, 200);
    assert.equal((await call('hook-' + tag, {update_id: 9})).status, 200);
    // A chat that floods the bot is ignored for the rest of the minute.
    const results: string[] = [];
    for (let index = 0; index < 31; index++) results.push(await handleUpdate(update('/lang en', hookChat)));
    assert.deepEqual([results.filter(result => result === 'answered').length, results.at(-1)], [29, 'limited']);
  });
});
