import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import nodeIcal from 'node-ical';
import {db} from '@dance/db';
import {schedule} from '../src/lib/schedule';
import {buildCalendar, etagOf, notModified, type IcsEvent} from '../src/lib/calendar/ics';
import {googleCalendarUrl, feedPath, siteOrigin} from '../src/lib/calendar/links';
import {transitions, vtimezone, wallClock, zoneLabel} from '../src/lib/calendar/time';
import {calendarFilters, eventWhere, findFeedEvents, findOccurrences, MAX_RANGE_DAYS, rangeSchema, withDescendants} from '../src/lib/calendar/query';
config({path: '../../.env', quiet: true});
const origin = 'https://dance.example';
const lines = (body: string) => body.replace(/\r\n[ \t]/g, '').split('\r\n');
function sample(id: string, timezone: string, city: string, start: string, end: string | null, extra: Partial<IcsEvent> = {}): IcsEvent {
  const startsAt = new Date(start), endsAt = end ? new Date(end) : null;
  return {id, slug: id, title: 'Lindy Hop, level 1; "open"', description: 'Bring shoes.\nNo partner needed.', timezone, status: 'PUBLISHED',
    updatedAt: new Date('2026-09-01T10:00:00Z'), startsAt, endsAt, city: {name: city}, venue: null,
    occurrences: [{id: id + '-o1', startsAt, endsAt, cancelled: false}], ...extra};
}
test('ICS keeps the local hour and TZID for Mexico City, Madrid and Moscow events', () => {
  const body = buildCalendar({name: 'Dance events', origin, events: [
    sample('mx', 'America/Mexico_City', 'Ciudad de México', '2026-11-15T02:00:00Z', '2026-11-15T05:00:00Z'),
    sample('es', 'Europe/Madrid', 'Madrid', '2026-07-10T18:30:00Z', '2026-07-10T20:00:00Z', {venue: {name: 'Sala Swing', address: 'Calle Mayor 1, Madrid', hiddenAt: null}}),
    sample('ru', 'Europe/Moscow', 'Москва', '2026-12-05T16:00:00Z', null, {status: 'CANCELLED'})]});
  const out = lines(body);
  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n') && body.trimEnd().endsWith('END:VCALENDAR'));
  // 02:00Z is 20:00 of the previous day in Mexico City (UTC-6, no DST since 2022).
  for (const line of ['DTSTART;TZID=America/Mexico_City:20261114T200000', 'DTEND;TZID=America/Mexico_City:20261114T230000',
    'DTSTART;TZID=Europe/Madrid:20260710T203000', 'DTEND;TZID=Europe/Madrid:20260710T220000', 'DTSTART;TZID=Europe/Moscow:20261205T190000',
    'UID:mx-o1@dance.example', 'UID:es-o1@dance.example', 'UID:ru-o1@dance.example', 'X-WR-CALNAME:Dance events', 'METHOD:PUBLISH',
    'LOCATION:Sala Swing\\, Calle Mayor 1\\, Madrid', 'LOCATION:Ciudad de México', 'LOCATION:Москва',
    'URL;VALUE=URI:https://dance.example/en/events/es?date=2026-07-10T18%3A30%3A00.000Z',
    'SUMMARY:Lindy Hop\\, level 1\\; "open"', 'DTSTAMP:20260901T100000Z'])
    assert.ok(out.includes(line), 'missing ' + line + '\n' + body);
  assert.equal(out.filter(l => l === 'STATUS:CONFIRMED').length, 2);
  assert.equal(out.filter(l => l === 'STATUS:CANCELLED').length, 1);
  assert.equal(out.filter(l => l.startsWith('DTEND')).length, 2, 'an event without an end has no DTEND');
  assert.ok(out.some(l => l.startsWith('DESCRIPTION:Bring shoes.\\nNo partner needed.\\n\\nhttps://dance.example/en/events/mx')));
  for (const zone of ['America/Mexico_City', 'Europe/Madrid', 'Europe/Moscow']) assert.ok(out.includes('TZID:' + zone), 'VTIMEZONE ' + zone);
  // A hidden venue is never leaked; the city is used instead.
  const hidden = buildCalendar({name: 'x', origin, events: [sample('h', 'Europe/Madrid', 'Madrid', '2026-07-10T18:30:00Z', null, {venue: {name: 'Secret', address: 'Nowhere', hiddenAt: new Date()}})]});
  assert.ok(lines(hidden).includes('LOCATION:Madrid') && !hidden.includes('Secret'));
  // Same data, same bytes: the ETag is stable between polls.
  assert.equal(etagOf(body), etagOf(buildCalendar({name: 'Dance events', origin, events: [
    sample('mx', 'America/Mexico_City', 'Ciudad de México', '2026-11-15T02:00:00Z', '2026-11-15T05:00:00Z'),
    sample('es', 'Europe/Madrid', 'Madrid', '2026-07-10T18:30:00Z', '2026-07-10T20:00:00Z', {venue: {name: 'Sala Swing', address: 'Calle Mayor 1, Madrid', hiddenAt: null}}),
    sample('ru', 'Europe/Moscow', 'Москва', '2026-12-05T16:00:00Z', null, {status: 'CANCELLED'})]})));
});
test('an independent iCal parser reads back the same instants', () => {
  const events = [sample('mx', 'America/Mexico_City', 'CDMX', '2026-11-15T02:00:00Z', '2026-11-15T05:00:00Z'),
    sample('es', 'Europe/Madrid', 'Madrid', '2026-10-25T18:00:00Z', '2026-10-25T19:30:00Z'), sample('ru', 'Europe/Moscow', 'Moscow', '2026-12-05T16:00:00Z', '2026-12-05T18:00:00Z')];
  const parsed = Object.values(nodeIcal.sync.parseICS(buildCalendar({name: 'x', origin, events}))).filter(e => e && e.type === 'VEVENT') as {uid: string; start: Date; end: Date}[];
  assert.equal(parsed.length, 3);
  for (const event of events) {
    const got = parsed.find(p => p.uid === event.id + '-o1@dance.example');
    assert.ok(got, event.id);
    assert.equal(new Date(got.start).toISOString(), event.startsAt.toISOString());
    assert.equal(new Date(got.end).toISOString(), event.endsAt!.toISOString());
  }
});
test('weekly Madrid class stays at 19:00 on its Sunday across the October and March DST changes', () => {
  for (const [first, change, onset, fromOffset, toOffset] of [
    ['2026-10-18', '2026-10-25', '20261025T030000', '+0200', '+0100'], ['2027-03-21', '2027-03-28', '20270328T020000', '+0100', '+0200']] as const) {
    const series = schedule(first + 'T19:00', first + 'T20:30', 'Europe/Madrid', 3);
    const event = sample('madrid-' + first, 'Europe/Madrid', 'Madrid', series.startsAt.toISOString(), series.endsAt.toISOString(),
      {occurrences: series.occurrences.map((o, i) => ({id: 'w' + i, startsAt: o.startsAt, endsAt: o.endsAt, cancelled: i === 1}))});
    // What the calendar grid receives: wall-clock strings, one calendar week apart, always 19:00.
    const walls = series.occurrences.map(o => wallClock(o.startsAt, 'Europe/Madrid'));
    assert.deepEqual(walls.map(w => w.slice(11)), ['19:00:00', '19:00:00', '19:00:00']);
    assert.equal(walls[1].slice(0, 10), change);
    assert.deepEqual(walls.map(w => new Date(w + 'Z').getUTCDay()), [0, 0, 0], 'no off-by-one day');
    assert.equal((Date.parse(walls[2] + 'Z') - Date.parse(walls[0] + 'Z')) / 86400000, 14);
    // The real instants are NOT 7x24h apart on the change week: the UTC hour moves, the local hour does not.
    assert.notEqual(series.occurrences[1].startsAt.getUTCHours(), series.occurrences[0].startsAt.getUTCHours());
    const body = buildCalendar({name: 'x', origin, events: [event]}), out = lines(body);
    assert.deepEqual(out.filter(l => l.startsWith('DTSTART;TZID=')).map(l => l.slice(-6)), ['190000', '190000', '190000']);
    assert.ok(out.includes('DTSTART;TZID=Europe/Madrid:' + change.replace(/-/g, '') + 'T190000'));
    // Only the cancelled date of the series is cancelled.
    const statuses = out.filter(l => l.startsWith('STATUS:'));
    assert.deepEqual(statuses, ['STATUS:CONFIRMED', 'STATUS:CANCELLED', 'STATUS:CONFIRMED']);
    assert.deepEqual(out.filter(l => l.startsWith('UID:')), ['UID:w0@dance.example', 'UID:w1@dance.example', 'UID:w2@dance.example']);
    // The VTIMEZONE describes the change itself: local onset read with the old offset.
    const at = out.indexOf('DTSTART:' + onset);
    assert.ok(at > 0, 'VTIMEZONE transition ' + onset + '\n' + body);
    assert.deepEqual(out.slice(at + 1, at + 3), ['TZOFFSETFROM:' + fromOffset, 'TZOFFSETTO:' + toOffset]);
    const parsed = Object.values(nodeIcal.sync.parseICS(body)).filter(e => e && e.type === 'VEVENT') as {start: Date}[];
    assert.deepEqual(parsed.map(p => new Date(p.start).toISOString()).sort(), series.occurrences.map(o => o.startsAt.toISOString()));
  }
});
test('zone helpers: transitions, labels, a party over the fall-back night and zones without DST', () => {
  const madrid = transitions('Europe/Madrid', Date.parse('2026-01-01T00:00:00Z'), Date.parse('2027-01-01T00:00:00Z'));
  assert.deepEqual(madrid.map(t => [new Date(t.at).toISOString(), t.before, t.after]), [['2026-03-29T01:00:00.000Z', 60, 120], ['2026-10-25T01:00:00.000Z', 120, 60]]);
  assert.deepEqual(transitions('Europe/Moscow', Date.parse('2026-01-01T00:00:00Z'), Date.parse('2028-01-01T00:00:00Z')), []);
  assert.deepEqual(transitions('America/Mexico_City', Date.parse('2026-01-01T00:00:00Z'), Date.parse('2028-01-01T00:00:00Z')), []);
  const moscow = vtimezone('Europe/Moscow', new Date('2026-06-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'));
  assert.ok(moscow.includes('BEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0300\r\nTZOFFSETTO:+0300'));
  assert.ok(vtimezone('America/Mexico_City', new Date('2026-06-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z')).includes('TZOFFSETTO:-0600'));
  // 23:00 Saturday to 04:00 Sunday local on the night the clocks go back lasts six real hours.
  assert.equal(wallClock('2026-10-24T21:00:00.000Z', 'Europe/Madrid'), '2026-10-24T23:00:00');
  assert.equal(wallClock('2026-10-25T03:00:00.000Z', 'Europe/Madrid'), '2026-10-25T04:00:00');
  // "My time zone": the same Madrid class for a visitor in Mexico City and in Moscow.
  assert.equal(wallClock('2026-10-25T18:00:00.000Z', 'America/Mexico_City'), '2026-10-25T12:00:00');
  assert.equal(wallClock('2026-10-25T18:00:00.000Z', 'Europe/Moscow'), '2026-10-25T21:00:00');
  assert.equal(zoneLabel('2026-07-01T12:00:00Z', 'Europe/Moscow', 'en'), 'GMT+3');
  assert.notEqual(zoneLabel('2026-07-01T12:00:00Z', 'Europe/Madrid', 'en'), zoneLabel('2026-12-01T12:00:00Z', 'Europe/Madrid', 'en'));
  assert.throws(() => wallClock('2026-07-01T12:00:00Z', 'Mars/Olympus'));
});
test('Google Calendar link carries local wall-clock dates, ctz and correctly encoded text', () => {
  const url = new URL(googleCalendarUrl({title: 'Swing & Blues: "Noche" ñ + джаз', timezone: 'Europe/Madrid', location: 'Sala Swing, Calle Mayor 1',
    details: 'Línea 1\nLínea 2 & más', url: 'https://dance.example/es/events/noche?date=2026-10-25T18%3A00%3A00.000Z'},
  {startsAt: '2026-10-25T18:00:00.000Z', endsAt: new Date('2026-10-25T21:30:00Z')}));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('dates'), '20261025T190000/20261025T223000');
  assert.equal(url.searchParams.get('ctz'), 'Europe/Madrid');
  assert.equal(url.searchParams.get('text'), 'Swing & Blues: "Noche" ñ + джаз');
  assert.equal(url.searchParams.get('location'), 'Sala Swing, Calle Mayor 1');
  assert.equal(url.searchParams.get('details'), 'Línea 1\nLínea 2 & más\n\nhttps://dance.example/es/events/noche?date=2026-10-25T18%3A00%3A00.000Z');
  // Nothing may break out of its parameter: no raw &, +, #, quote, space or non-ASCII in the query string.
  assert.match(url.search, /^\?[A-Za-z0-9%&=._*+-]+$/);
  assert.ok(url.search.includes('text=Swing+%26+Blues%3A+%22Noche%22+%C3%B1+%2B+'));
  const open = new URL(googleCalendarUrl({title: 'Practice', timezone: 'America/Mexico_City'}, {startsAt: '2026-11-15T02:00:00.000Z'}));
  assert.equal(open.searchParams.get('dates'), '20261114T200000/20261114T210000');
  assert.equal(open.searchParams.has('details') || open.searchParams.has('location'), false);
  assert.equal(feedPath({citySlug: 'madrid', styleSlug: 'lindy-hop', locale: 'es'}), '/api/feeds/ical?city=madrid&style=lindy-hop&locale=es');
  assert.equal(feedPath({}), '/api/feeds/ical');
});
test('filter parsing, style descendants, visibility and the range cap', () => {
  const tree = [{id: 's', slug: 'swing', parentId: null}, {id: 'c', slug: 'charleston', parentId: 's'}, {id: 'sc', slug: 'solo-charleston', parentId: 'c'},
    {id: 'l', slug: 'lindy-hop', parentId: 's'}, {id: 't', slug: 'tango', parentId: null}];
  assert.deepEqual(withDescendants(['swing'], tree).sort(), ['c', 'l', 's', 'sc']);
  assert.deepEqual(withDescendants(['charleston', 'tango'], tree).sort(), ['c', 'sc', 't']);
  assert.deepEqual(withDescendants(['unknown'], tree), []);
  const filters = calendarFilters(new URLSearchParams('city=madrid&city=moscow&city=madrid&style=swing&level=BEGINNER&level=bogus&kind=CLASS&kind=SOCIAL&kind='));
  assert.deepEqual(filters, {city: ['madrid', 'moscow'], style: ['swing'], level: ['BEGINNER'], kind: ['CLASS', 'SOCIAL']});
  const where = eventWhere(filters, ['s', 'l']);
  assert.equal(where.status, 'PUBLISHED');
  assert.equal(where.hiddenAt, null);
  assert.deepEqual(where.city, {OR: [{slug: {in: ['madrid', 'moscow']}}, {id: {in: ['madrid', 'moscow']}}]});
  assert.deepEqual(where.styles, {some: {styleId: {in: ['s', 'l']}}});
  assert.deepEqual(where.level, {in: ['BEGINNER']});
  assert.deepEqual(where.kind, {in: ['CLASS', 'SOCIAL']});
  assert.deepEqual(eventWhere(calendarFilters(new URLSearchParams()), [], true), {status: {in: ['PUBLISHED', 'CANCELLED']}, hiddenAt: null});
  assert.equal(rangeSchema.parse({from: '2026-10-01', to: '2026-11-15T00:00:00.000Z'}).from.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(rangeSchema.safeParse({from: '2026-01-01', to: '2026-04-11'}).success, true, MAX_RANGE_DAYS + ' days are allowed');
  for (const bad of [{from: '2026-01-01', to: '2026-04-12'}, {from: '2026-02-01', to: '2026-01-01'}, {from: 'yesterday', to: '2026-01-01'}, {from: '', to: ''}])
    assert.equal(rangeSchema.safeParse(bad).success, false, JSON.stringify(bad));
});
test('notModified: ETag decides, If-Modified-Since is only a fallback', () => {
  const modified = new Date('2026-09-01T10:00:00.500Z'), request = (headers: Record<string, string>) => new Request('http://x/feed', {headers});
  assert.equal(notModified(request({}), '"a"', modified), false);
  assert.equal(notModified(request({'If-None-Match': '"a"'}), '"a"', modified), true);
  assert.equal(notModified(request({'If-None-Match': 'W/"a", "b"'}), '"a"', modified), true);
  assert.equal(notModified(request({'If-None-Match': '"b"', 'If-Modified-Since': 'Tue, 01 Sep 2026 10:00:00 GMT'}), '"a"', modified), false);
  assert.equal(notModified(request({'If-Modified-Since': 'Tue, 01 Sep 2026 10:00:00 GMT'}), '"a"', modified), true);
  assert.equal(notModified(request({'If-Modified-Since': 'Tue, 01 Sep 2026 09:59:59 GMT'}), '"a"', modified), false);
  assert.equal(notModified(request({'If-Modified-Since': 'garbage'}), '"a"', modified), false);
});
// ---- Database-backed tests. Rows live in 2031, far outside every real listing and the six-month feed window. ----
const tag = 'caltest-' + randomUUID().slice(0, 8), ids: Record<string, string> = {};
const range = {from: new Date('2031-05-01T00:00:00Z'), to: new Date('2031-06-10T00:00:00Z')};
const none = {city: [], style: [], level: [], kind: []};
const mine = (rows: {slug: string}[]) => rows.filter(r => r.slug.startsWith(tag)).map(r => r.slug.slice(tag.length + 1));
async function create(name: string, cityId: string, timezone: string, local: string, weeks: number, data: Record<string, unknown> = {}, styleId = 'lindy-hop') {
  const times = schedule(local, local.slice(0, 11) + '21:00', timezone, weeks);
  const event = await db.event.create({data: {slug: tag + '-' + name, title: 'Calendar test ' + name, description: 'Calendar test event', timezone, cityId,
    startsAt: times.startsAt, endsAt: times.endsAt, rrule: times.rrule, status: 'PUBLISHED', kind: 'CLASS', level: 'BEGINNER', ...data,
    styles: {create: {styleId}}, occurrences: {create: times.occurrences}}});
  ids[name] = event.id;
  return event;
}
before(async () => {
  await create('madrid', 'madrid', 'Europe/Madrid', '2031-05-12T19:00', 3);
  await create('moscow', 'moscow', 'Europe/Moscow', '2031-05-13T19:00', 1, {kind: 'SOCIAL', level: 'OPEN'}, 'solo-charleston');
  await create('mexico', 'mexico-city', 'America/Mexico_City', '2031-05-14T20:00', 1, {kind: 'WORKSHOP', level: 'ADVANCED'}, 'balboa');
  await create('draft', 'madrid', 'Europe/Madrid', '2031-05-15T19:00', 1, {status: 'DRAFT'});
  await create('hidden', 'madrid', 'Europe/Madrid', '2031-05-16T19:00', 1, {hiddenAt: new Date()});
  await create('cancelled', 'madrid', 'Europe/Madrid', '2031-05-17T19:00', 1, {status: 'CANCELLED'});
  const second = await db.eventOccurrence.findFirstOrThrow({where: {eventId: ids.madrid}, orderBy: {startsAt: 'asc'}, skip: 1});
  await db.eventOccurrence.update({where: {id: second.id}, data: {cancelled: true}});
});
after(async () => {
  await db.event.deleteMany({where: {slug: {startsWith: tag}}});
  await db.$disconnect();
});
test('occurrence query: only published visible events, filters by city, style family, level, kind and range', async () => {
  const all = await findOccurrences(range, none);
  assert.deepEqual(mine(all.occurrences), ['madrid', 'moscow', 'mexico', 'madrid', 'madrid'], 'drafts, hidden and cancelled events are absent; ordered by start');
  const madrid = all.occurrences.filter(o => o.eventId === ids.madrid);
  assert.deepEqual(madrid.map(o => o.cancelled), [false, true, false], 'a cancelled date stays, flagged');
  assert.deepEqual(madrid.map(o => o.localStart), ['2031-05-12T19:00:00', '2031-05-19T19:00:00', '2031-05-26T19:00:00']);
  assert.equal(madrid[0].startsAt, '2031-05-12T17:00:00.000Z');
  assert.equal(madrid[0].timezone, 'Europe/Madrid');
  assert.equal(all.occurrences.find(o => o.eventId === ids.mexico)!.localStart, '2031-05-14T20:00:00');
  const by = async (query: string, window = range) => mine((await findOccurrences(window, calendarFilters(new URLSearchParams(query)))).occurrences);
  assert.deepEqual(await by('city=madrid'), ['madrid', 'madrid', 'madrid']);
  assert.deepEqual(await by('city=moscow&city=mexico-city'), ['moscow', 'mexico']);
  assert.deepEqual(await by('style=swing'), ['madrid', 'moscow', 'mexico', 'madrid', 'madrid'], 'parent style includes every descendant');
  assert.deepEqual(await by('style=charleston'), ['moscow'], 'solo-charleston is found through its parent');
  assert.deepEqual(await by('style=charleston&style=balboa'), ['moscow', 'mexico']);
  assert.deepEqual(await by('style=tango'), []);
  assert.deepEqual(await by('style=no-such-style'), []);
  assert.deepEqual(await by('level=OPEN&level=ADVANCED'), ['moscow', 'mexico']);
  assert.deepEqual(await by('kind=WORKSHOP'), ['mexico']);
  assert.deepEqual(await by('city=madrid&kind=SOCIAL'), [], 'groups are combined with AND');
  assert.deepEqual(await by('', {from: new Date('2031-05-19T00:00:00Z'), to: new Date('2031-05-20T00:00:00Z')}), ['madrid']);
  // Still running at the start of the window (19:00-21:00 Madrid is 17:00-19:00 UTC) counts as overlapping.
  assert.deepEqual(await by('', {from: new Date('2031-05-12T18:00:00Z'), to: new Date('2031-05-12T18:30:00Z')}), ['madrid']);
  assert.deepEqual(await by('', {from: new Date('2031-05-12T19:00:00Z'), to: new Date('2031-05-12T19:30:00Z')}), []);
});
test('feed query adds cancelled events but never drafts or hidden ones', async () => {
  const events = await findFeedEvents(none, range);
  assert.deepEqual(mine(events).sort(), ['cancelled', 'madrid', 'mexico', 'moscow']);
  assert.equal(events.find(e => e.id === ids.madrid)!.occurrences.length, 3);
  const body = buildCalendar({name: 'x', origin, events: events.filter(e => e.slug.startsWith(tag))});
  assert.equal(lines(body).filter(l => l === 'STATUS:CANCELLED').length, 2, 'one cancelled date + one cancelled event');
  assert.deepEqual(mine(await findFeedEvents({...none, city: ['madrid'], style: ['lindy-hop']}, range)).sort(), ['cancelled', 'madrid']);
});
test('GET /api/events/[id]/ics: attachment by id or slug, 404 for drafts and hidden, 304 until the event changes', async () => {
  const {GET} = await import('../src/app/api/events/[id]/ics/route');
  const call = (id: string, headers: Record<string, string> = {}) => GET(new Request('http://localhost:3000/api/events/' + id + '/ics', {headers}), {params: Promise.resolve({id})});
  const response = await call(ids.madrid), body = await response.text(), host = new URL(siteOrigin()).host, out = lines(body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="' + tag + '-madrid.ics"');
  const rows = await db.eventOccurrence.findMany({where: {eventId: ids.madrid}, orderBy: {startsAt: 'asc'}});
  assert.deepEqual(out.filter(l => l.startsWith('UID:')), rows.map(r => 'UID:' + r.id + '@' + host), 'one VEVENT per materialized date, stable UIDs');
  assert.deepEqual(out.filter(l => l.startsWith('DTSTART;')), ['20310512', '20310519', '20310526'].map(d => 'DTSTART;TZID=Europe/Madrid:' + d + 'T190000'));
  assert.deepEqual(out.filter(l => l.startsWith('STATUS:')), ['STATUS:CONFIRMED', 'STATUS:CANCELLED', 'STATUS:CONFIRMED']);
  assert.ok(out.includes('LOCATION:Madrid'));
  assert.equal(await (await call(tag + '-madrid')).text(), body, 'slug works like id');
  for (const name of ['draft', 'hidden']) assert.equal((await call(ids[name])).status, 404, name);
  assert.equal((await call(tag + '-draft')).status, 404);
  assert.equal((await call('no-such-event')).status, 404);
  const whole = await call(ids.cancelled), cancelled = lines(await whole.text());
  assert.equal(whole.status, 200);
  assert.deepEqual(cancelled.filter(l => l.startsWith('STATUS:')), ['STATUS:CANCELLED']);
  const etag = response.headers.get('etag')!;
  assert.match(etag, /^"[\w-]+"$/);
  assert.ok(response.headers.get('last-modified'));
  const cached = await call(ids.madrid, {'If-None-Match': etag});
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  assert.equal(cached.headers.get('etag'), etag);
  await db.eventOccurrence.update({where: {id: rows[2].id}, data: {cancelled: true}});
  const changed = await call(ids.madrid, {'If-None-Match': etag});
  assert.equal(changed.status, 200, 'cancelling one date changes the ETag even though the event row is untouched');
  assert.notEqual(changed.headers.get('etag'), etag);
});
test('GET /api/feeds/ical: subscription headers and 304 on a matching validator', async () => {
  const {GET} = await import('../src/app/api/feeds/ical/route');
  // Tango in Mexico City: a slice no other test writes to, so the body is stable between the two requests.
  const url = 'http://localhost:3000/api/feeds/ical?city=mexico-city&style=tango&locale=es';
  const response = await GET(new Request(url)), body = await response.text(), out = lines(body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  assert.ok(Number.isFinite(Date.parse(response.headers.get('last-modified')!)));
  assert.ok(out.some(l => /^X-WR-CALNAME:Eventos de baile · .+ · .+$/.test(l)), body);
  assert.ok(out.includes('REFRESH-INTERVAL;VALUE=DURATION:PT1H') && out.includes('X-PUBLISHED-TTL:PT1H'));
  assert.ok(out.includes('X-WR-TIMEZONE:America/Mexico_City'));
  assert.ok(!body.includes(tag), 'events outside the six-month window are not in the feed');
  const etag = response.headers.get('etag')!;
  const cached = await GET(new Request(url, {headers: {'If-None-Match': etag}}));
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  assert.equal(cached.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal((await GET(new Request(url, {headers: {'If-None-Match': '"stale"'}}))).status, 200);
  const occurrences = await import('../src/app/api/calendar/occurrences/route');
  const tooWide = await occurrences.GET(new Request('http://localhost:3000/api/calendar/occurrences?from=2031-01-01&to=2031-12-31'));
  assert.equal(tooWide.status, 400);
  const ok = await occurrences.GET(new Request('http://localhost:3000/api/calendar/occurrences?from=2031-05-01&to=2031-06-01&city=moscow&style=charleston'));
  assert.equal(ok.status, 200);
  assert.deepEqual(mine((await ok.json()).occurrences), ['moscow']);
});
