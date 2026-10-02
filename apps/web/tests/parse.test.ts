// Announcement parser. Hermetic: the model and the geocoder are stubs. Run: pnpm --filter @dance/web exec tsx --test tests/parse.test.ts
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {buildMessages, cacheHash, cleanInput, MAX_INPUT, parsedAnnouncement} from '../src/lib/events/parse/contract';
import {matchLevel, matchStyles, toSuggestion} from '../src/lib/events/parse/normalize';
import {clearParseMemory, parseAnnouncement, recordParseFeedback} from '../src/lib/events/parse';
import {closeRedis} from '../src/lib/redis';
after(async () => {await closeRedis();});
const city = {id: 'madrid', name: 'Madrid', timezone: 'Europe/Madrid', lat: 40.4168, lng: -3.7038, countryCode: 'ES'};
const styles = [{id: 'lindy-hop', slug: 'lindy-hop', name: 'Lindy Hop'}, {id: 'solo-jazz', slug: 'solo-jazz', name: 'Solo Jazz'}, {id: 'balboa', slug: 'balboa', name: 'Balboa'}];
const venues = [{id: 'v1', name: 'Big Mama Ballroom', address: 'Calle Mayor 1'}];
const now = new Date('2026-10-01T10:00:00Z');
const answer = (extra: object = {}) => JSON.stringify({title: 'Swing Night', startsAtLocal: '2026-10-14T22:00', endsAtLocal: null, recurrence: null, venueName: null,
  address: null, styles: ['lindy-hop'], level: null, price: '10 €', artists: [], instagramUrls: [], confidence: 0.9, ...extra});
const noGeo = async () => null;
test('contract: missing and malformed values become null, lists become empty, input is cut to the limit', () => {
  const parsed = parsedAnnouncement.parse({title: '  ', startsAtLocal: 5, styles: 'salsa', confidence: 3, recurrence: 'daily'});
  assert.deepEqual(parsed, {title: null, startsAtLocal: null, endsAtLocal: null, recurrence: null, venueName: null, address: null, styles: [], level: null, price: null,
    artists: [], instagramUrls: [], confidence: 0});
  assert.equal(cleanInput('a'.repeat(MAX_INPUT + 50)).length, MAX_INPUT);
  assert.equal(cleanInput('line\r\nnext\u0000'), 'line\nnext');
  assert.notEqual(cacheHash('text', 'Europe/Madrid', '2026-10-01'), cacheHash('text', 'Europe/Madrid', '2026-10-02'));
  assert.notEqual(cacheHash('text', 'Europe/Madrid', '2026-10-01', 'madrid'), cacheHash('text', 'Europe/Madrid', '2026-10-01', 'mexico-city'));
});
test('prompt carries today, the zone and the style codes, and nothing about the user', () => {
  const [system, user] = buildMessages('Party on Saturday', {today: '2026-10-01', weekday: 'Thursday', zone: 'Europe/Madrid', cityName: 'Madrid', styleCodes: ['lindy-hop', 'balboa']});
  assert.match(system.content, /2026-10-01 \(Thursday\)/);
  assert.match(system.content, /Europe\/Madrid/);
  assert.match(system.content, /lindy-hop, balboa/);
  assert.match(system.content, /Never invent/);
  assert.match(user.content, /Party on Saturday/);
});
test('styles and levels are matched to the directory, never substituted silently', () => {
  const {matched, unmatched} = matchStyles(['lindy-hop', 'Solo jazz', 'Zumba', 'balb'], styles);
  assert.deepEqual(matched.map(style => style.id), ['lindy-hop', 'solo-jazz', 'balboa']);
  assert.deepEqual(unmatched, ['Zumba']);
  assert.equal(matchLevel('для начинающих'), 'BEGINNER');
  assert.equal(matchLevel('todos los niveles'), 'OPEN');
  assert.equal(matchLevel('Intermediate+'), 'INTERMEDIATE');
  assert.equal(matchLevel('fun'), null);
});
test('normalization: dates checked in the city zone, venue matched, address geocoded or reported', async () => {
  const base = parsedAnnouncement.parse(JSON.parse(answer({endsAtLocal: '2026-10-15T02:00', level: 'beginners', venueName: 'big mama ballroom'})));
  const withVenue = await toSuggestion(base, 'Swing Night at Big Mama, 22:00', {city, styles, venues, geocode: noGeo, now});
  assert.deepEqual(withVenue.fields, {title: 'Swing Night', description: 'Swing Night at Big Mama, 22:00', startsLocal: '2026-10-14T22:00', endsLocal: '2026-10-15T02:00',
    styleId: 'lindy-hop', level: 'BEGINNER', priceText: '10 €', venueId: 'v1'});
  const near = await toSuggestion({...base, venueName: null, address: 'Gran Vía 10'}, 'x'.repeat(20), {city, styles, venues, now, geocode: async () => ({lat: 40.42, lng: -3.70})});
  assert.equal(near.fields.lat, '40.42');
  const far = await toSuggestion({...base, venueName: null, address: 'Somewhere'}, 'x'.repeat(20), {city, styles, venues, now, geocode: async () => ({lat: 48.85, lng: 2.35})});
  assert.equal(far.fields.lat, undefined);
  assert.deepEqual(far.warnings, ['ADDRESS_NOT_FOUND']);
  // A time skipped by daylight saving and an end before the start are dropped, not guessed.
  const gap = await toSuggestion({...base, startsAtLocal: '2027-03-28T02:30', endsAtLocal: null, venueName: null}, 'x'.repeat(20), {city, styles, venues, geocode: noGeo, now});
  assert.equal(gap.fields.startsLocal, undefined);
  assert.ok(gap.warnings.includes('DATE_UNCLEAR'));
  const past = await toSuggestion({...base, startsAtLocal: '2026-09-01T20:00', endsAtLocal: '2026-09-01T19:00', venueName: null}, 'x'.repeat(20), {city, styles, venues, geocode: noGeo, now});
  assert.equal(past.fields.endsLocal, undefined);
  assert.ok(past.warnings.includes('PAST_DATE'));
  const urls = await toSuggestion({...base, venueName: null, recurrence: 'weekly', instagramUrls: ['https://www.instagram.com/p/abc/?utm=1', 'https://evil.example/p/abc']},
    'x'.repeat(20), {city, styles, venues, geocode: noGeo, now});
  assert.deepEqual(urls.notes.instagramUrls, ['https://www.instagram.com/p/abc/']);
  assert.ok(urls.warnings.includes('RECURS_WEEKLY'));
});
test('one retry on invalid JSON, then the manual form; the same text costs one call; low confidence is flagged', async () => {
  clearParseMemory();
  const text = 'Swing Night this month, unique ' + Math.random();
  let calls = 0;
  const flaky = async () => {calls++; return calls === 1 ? 'not json' : answer({confidence: 0.4});};
  const first = await parseAnnouncement(text, {city, styles, venues, geocode: noGeo, llm: flaky, now});
  assert.equal(calls, 2);
  assert.equal(first?.fields.title, 'Swing Night');
  assert.equal(first?.lowConfidence, true);
  const second = await parseAnnouncement(text, {city, styles, venues, geocode: noGeo, llm: flaky, now});
  assert.equal(calls, 2, 'cached answer, no further model call');
  assert.equal(second?.cached, true);
  assert.notEqual(second?.parseId, first?.parseId);
  let broken = 0;
  const never = await parseAnnouncement('Another announcement ' + Math.random(), {city, styles, venues, geocode: noGeo, now, llm: async () => {broken++; return '{';}});
  assert.equal(never, null);
  assert.equal(broken, 2);
  assert.equal(await parseAnnouncement('short', {city, styles, venues, geocode: noGeo, now, llm: flaky}), null);
});
test('feedback reports the share of suggested fields the organizer kept', async () => {
  const result = await parseAnnouncement('Feedback announcement ' + Math.random(), {city, styles, venues, geocode: noGeo, now, llm: async () => answer()});
  assert.ok(result);
  const feedback = await recordParseFeedback(result.parseId, {...result.fields, title: 'Swing Night — edited'});
  assert.equal(feedback?.suggested, Object.keys(result.fields).length);
  assert.deepEqual(feedback?.editedFields, ['title']);
  assert.equal(await recordParseFeedback('not-an-id', {}), null);
  assert.equal(await recordParseFeedback('00000000-0000-0000-0000-000000000000', {}), null);
});
