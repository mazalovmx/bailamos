import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, utimes, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import Redis from 'ioredis';
import {Queue} from 'bullmq';
import {db} from '@dance/db';
import {closeRedis} from '../src/lib/redis';
import {dayPartOf, parseDayPart, parseLevels, parseWeekdays, styleFilter, weekOf, weekTimetable} from '../src/lib/courses/timetable';
import {findSchool, listSchools, schoolJsonLd, schoolVenues, upcomingSpecials} from '../src/lib/courses/schools';
import {courseText} from '../src/lib/courses/messages';
import {safeJson} from '../src/lib/events/jsonld';
import {buildDigest, selectDigestEvents, type DigestRow} from '../src/lib/digest/build';
import {claimDigest, digestWeekStart, renderDigest, sendDigest, sendWeeklyDigests, setDigestSubscription, digestSubscription, type DigestMail} from '../src/lib/digest/send';
import {unsubscribeToken, verifyUnsubscribeToken} from '../src/lib/digest/token';
import {cleanupStaleRows} from '../src/lib/jobs/maintenance';
import {sweepRawUploads} from '../src/lib/jobs/media';
import {loadReminders} from '../src/lib/jobs/reminders';
import {jobs, registryProblems, validCron} from '../src/worker/registry';
import {DEAD_LETTER_KEY, HEARTBEAT_KEY} from '../src/worker/keys';
import {POST as unsubscribePost} from '../src/app/api/digest/unsubscribe/route';
const run = 'ct' + randomUUID().slice(0, 8), id = (name: string) => run + '-' + name;
const at = (iso: string) => new Date(iso);
const ids = {tokyo: id('tokyo'), york: id('york'), quiet: id('quiet'), swing: id('swing'), lindy: id('lindy'), tango: id('tango'), venue: id('venue'),
  school: id('school'), owned: id('owned'), reader: id('reader'), lonely: id('lonely'), off: id('off'), unverified: id('unverified'), owner: id('owner')};
const mail = (name: string) => run + '-' + name + '@courses.test';
type EventInput = {key: string; city: string; kind?: string; status?: string; rrule?: string | null; level?: string; price?: string; venue?: boolean; hidden?: boolean;
  title?: string; zone: string; styles?: string[]; members?: [string, string][]; dates: (string | [string, boolean])[]};
async function event(input: EventInput) {
  const dates = input.dates.map(item => typeof item === 'string' ? [item, false] as const : item);
  await db.event.create({data: {id: id(input.key), slug: id(input.key), title: input.title ?? 'Event ' + input.key, startsAt: at(dates[0][0]), timezone: input.zone, cityId: input.city,
    status: (input.status ?? 'PUBLISHED') as 'PUBLISHED', kind: (input.kind ?? 'CLASS') as 'CLASS', level: (input.level ?? 'UNSPECIFIED') as 'OPEN',
    rrule: input.rrule === undefined ? 'FREQ=WEEKLY;COUNT=10' : input.rrule, priceText: input.price ?? null, venueId: input.venue ? ids.venue : null, hiddenAt: input.hidden ? new Date() : null,
    styles: {create: (input.styles ?? []).map(styleId => ({styleId}))},
    members: {create: (input.members ?? []).map(([profileId, role]) => ({profileId, role: role as 'OWNER'}))},
    occurrences: {create: dates.map(([startsAt, cancelled]) => ({startsAt: at(startsAt), endsAt: new Date(at(startsAt).getTime() + 3600_000), cancelled}))}}});
}
before(async () => {
  await db.city.createMany({data: [
    {id: ids.tokyo, slug: ids.tokyo, name: 'Testokyo', countryCode: 'JP', timezone: 'Asia/Tokyo', lat: 35.6, lng: 139.7},
    {id: ids.york, slug: ids.york, name: 'Testyork', countryCode: 'US', timezone: 'America/New_York', lat: 40.7, lng: -74},
    {id: ids.quiet, slug: ids.quiet, name: 'Quietville', countryCode: 'ES', timezone: 'Europe/Madrid', lat: 40.4, lng: -3.7}]});
  await db.danceStyle.create({data: {id: ids.swing, slug: ids.swing, name: 'Test Swing'}});
  await db.danceStyle.createMany({data: [{id: ids.lindy, slug: ids.lindy, name: 'Test Lindy', parentId: ids.swing}, {id: ids.tango, slug: ids.tango, name: 'Test Tango'}]});
  await db.venue.create({data: {id: ids.venue, name: 'Test Hall', address: '1 Swing St', cityId: ids.tokyo, lat: 35.6, lng: 139.7}});
  await db.user.createMany({data: [
    {id: ids.reader, name: 'Reader', email: mail('reader'), emailVerified: true, locale: 'ru'},
    {id: ids.lonely, name: 'Lonely', email: mail('lonely'), emailVerified: true, locale: 'es'},
    {id: ids.off, name: 'Off', email: mail('off'), emailVerified: true},
    {id: ids.unverified, name: 'Unverified', email: mail('unverified'), emailVerified: false},
    {id: ids.owner, name: 'Owner', email: mail('owner'), emailVerified: true}]});
  await db.profile.createMany({data: [
    // A stub: no owner yet. The name tries to break out of a JSON-LD script element.
    {id: ids.school, type: 'SCHOOL', handle: ids.school, name: 'Stub </script><script>alert(1)</script> School', cityId: ids.tokyo},
    {id: ids.owned, type: 'SCHOOL', handle: ids.owned, name: 'Owned School', cityId: ids.tokyo, userId: ids.owner}]});
  await db.notificationPreference.createMany({data: [{userId: ids.reader, emailDigest: true}, {userId: ids.lonely, emailDigest: true},
    {userId: ids.off, emailDigest: false}, {userId: ids.unverified, emailDigest: true}]});
  await db.follow.createMany({data: [{userId: ids.reader, cityId: ids.tokyo}, {userId: ids.reader, styleId: ids.swing}, {userId: ids.reader, profileId: ids.school},
    {userId: ids.lonely, cityId: ids.quiet}, {userId: ids.off, cityId: ids.tokyo}, {userId: ids.unverified, cityId: ids.tokyo}]});
  // Timetable week: Monday 2030-06-10 … Sunday 2030-06-16.
  await event({key: 'e1', city: ids.tokyo, zone: 'Asia/Tokyo', level: 'BEGINNER', price: '10 €', venue: true, styles: [ids.lindy], members: [[ids.school, 'OWNER'], [ids.school, 'ARTIST']],
    dates: ['2030-06-09T23:30:00Z', '2030-06-12T10:00:00Z', ['2030-06-14T10:00:00Z', true], '2030-06-16T23:30:00Z']});
  await event({key: 'e2', city: ids.tokyo, zone: 'Asia/Tokyo', kind: 'PRACTICE', level: 'OPEN', styles: [ids.tango], dates: ['2030-06-12T04:00:00Z']});
  await event({key: 'e3', city: ids.tokyo, zone: 'Asia/Tokyo', status: 'DRAFT', dates: ['2030-06-11T10:00:00Z']});
  await event({key: 'e4', city: ids.tokyo, zone: 'Asia/Tokyo', hidden: true, dates: ['2030-06-11T10:00:00Z']});
  await event({key: 'e5', city: ids.tokyo, zone: 'Asia/Tokyo', kind: 'WORKSHOP', rrule: null, venue: true, members: [[ids.school, 'ARTIST']], dates: ['2030-06-13T10:00:00Z']});
  await event({key: 'e6', city: ids.tokyo, zone: 'Asia/Tokyo', rrule: null, members: [[ids.school, 'OWNER']], dates: ['2030-06-11T09:00:00Z']});
  await event({key: 'e7', city: ids.york, zone: 'America/New_York', level: 'ADVANCED', dates: ['2030-06-17T02:00:00Z']});
  // Digest window: Monday 2031-03-03 06:00 UTC plus seven days.
  await event({key: 'd1', city: ids.tokyo, zone: 'Asia/Tokyo', kind: 'SOCIAL', title: '<b>Jam</b> & Co', styles: [ids.lindy], venue: true, price: '5 €', dates: ['2031-03-04T10:00:00Z', '2031-03-06T10:00:00Z']});
  await event({key: 'd2', city: ids.york, zone: 'America/New_York', level: 'BEGINNER', styles: [ids.lindy], dates: ['2031-03-05T01:00:00Z']});
  await event({key: 'd3', city: ids.york, zone: 'America/New_York', kind: 'WORKSHOP', rrule: null, members: [[ids.school, 'ARTIST']], dates: ['2031-03-08T15:00:00Z']});
  await event({key: 'd4', city: ids.tokyo, zone: 'Asia/Tokyo', status: 'DRAFT', dates: ['2031-03-05T10:00:00Z']});
  await event({key: 'd5', city: ids.tokyo, zone: 'Asia/Tokyo', dates: ['2031-03-11T10:00:00Z']});
  await event({key: 'd6', city: ids.tokyo, zone: 'Asia/Tokyo', hidden: true, dates: ['2031-03-05T10:00:00Z']});
  await event({key: 'd7', city: ids.tokyo, zone: 'Asia/Tokyo', dates: [['2031-03-05T10:00:00Z', true]]});
  await event({key: 'd8', city: ids.york, zone: 'America/New_York', styles: [ids.tango], dates: ['2031-03-05T10:00:00Z']});
});
after(async () => {
  await db.event.deleteMany({where: {id: {startsWith: run}}});
  await db.venue.deleteMany({where: {id: {startsWith: run}}});
  await db.profile.deleteMany({where: {id: {startsWith: run}}});
  await db.user.deleteMany({where: {id: {startsWith: run}}});
  await db.danceStyle.deleteMany({where: {id: {in: [ids.lindy, ids.tango]}}});
  await db.danceStyle.deleteMany({where: {id: ids.swing}});
  await db.city.deleteMany({where: {id: {startsWith: run}}});
  await db.$disconnect();
  await closeRedis();
});
test('weeks are Monday-to-Sunday calendar dates resolved in the city zone', () => {
  const week = weekOf('2030-06-12');
  assert.deepEqual([week.start, week.end, week.previous, week.next, week.iso], ['2030-06-10', '2030-06-16', '2030-06-03', '2030-06-17', '2030-W24']);
  assert.equal(week.dates.length, 7);
  assert.equal(weekOf('2030-W24').start, '2030-06-10');
  assert.equal(weekOf('2030-06-16').start, '2030-06-10', 'Sunday belongs to the week that started on Monday');
  // Sunday 23:30 UTC is already Monday morning in Tokyo.
  const now = at('2030-06-09T23:30:00Z');
  assert.equal(weekOf(null, 'Asia/Tokyo', now).start, '2030-06-10');
  assert.equal(weekOf(null, 'UTC', now).start, '2030-06-03');
  for (const junk of ['yesterday', '2030-13-45', '<script>', '1700-01-01', '']) assert.equal(weekOf(junk, 'UTC', now).start, '2030-06-03', junk);
  assert.equal(weekOf(null, 'Not/AZone', now).start, '2030-06-03');
  assert.deepEqual([dayPartOf(8 * 60), dayPartOf(12 * 60), dayPartOf(16 * 60 + 59), dayPartOf(17 * 60)], ['morning', 'afternoon', 'afternoon', 'evening']);
  assert.deepEqual(parseLevels('BEGINNER,GOD,OPEN'), ['OPEN', 'BEGINNER']);
  assert.deepEqual(parseWeekdays('1,7,8,x,1'), [1, 7]);
  assert.equal(parseDayPart('evening'), 'evening');
  assert.equal(parseDayPart('night'), null);
});
test('timetable: published recurring classes only, placed on the local day of their own zone', async () => {
  const week = weekOf('2030-06-10'), timetable = await weekTimetable(week, {cityId: ids.tokyo});
  assert.equal(timetable.total, 3);
  assert.equal(timetable.truncated, false);
  assert.deepEqual(timetable.days.map(day => day.entries.map(entry => entry.eventId.replace(run + '-', '') + '@' + entry.localStart)),
    [['e1@08:30'], [], ['e2@13:00', 'e1@19:00'], [], [], [], []]);
  const monday = timetable.days[0].entries[0];
  // 23:30 UTC on Sunday is Monday 08:30 in Tokyo: the class belongs to Monday of this week, not to the week before.
  assert.deepEqual([monday.date, monday.weekday, monday.localEnd, monday.level, monday.priceText, monday.venue?.name, monday.city.name],
    ['2030-06-10', 1, '09:30', 'BEGINNER', '10 €', 'Test Hall', 'Testokyo']);
  assert.deepEqual(monday.hosts, [{handle: ids.school, name: 'Stub </script><script>alert(1)</script> School', type: 'SCHOOL'}], 'a profile with two roles is listed once');
  assert.deepEqual(monday.styles.map(style => style.slug), [ids.lindy]);
  // Draft, hidden, cancelled, one-off and workshop rows never appear.
  const seen = new Set(timetable.days.flatMap(day => day.entries.map(entry => entry.eventId)));
  for (const key of ['e3', 'e4', 'e5', 'e6']) assert.equal(seen.has(id(key)), false, key);
  assert.equal(timetable.days[4].entries.length, 0, 'the cancelled Friday date is not shown');
  // New York: 02:00 UTC on Monday the 17th is still Sunday 22:00 of this week there.
  const york = await weekTimetable(week, {cityId: ids.york});
  assert.deepEqual(york.days[6].entries.map(entry => [entry.date, entry.weekday, entry.localStart, entry.timezone]), [['2030-06-16', 7, '22:00', 'America/New_York']]);
  assert.equal(york.total, 1);
  assert.equal((await weekTimetable(weekOf('2030-06-17'), {cityId: ids.york})).total, 0);
  assert.deepEqual((await weekTimetable(weekOf('2030-06-17'), {cityId: ids.tokyo})).days[0].entries.map(entry => entry.localStart), ['08:30']);
});
test('timetable filters: style with descendants, level, weekday, time of day, school', async () => {
  const week = weekOf('2030-06-10'), styles = await db.danceStyle.findMany({where: {id: {startsWith: run}}, select: {id: true, slug: true, name: true, parentId: true}});
  const keys = async (filters: Parameters<typeof weekTimetable>[1]) => (await weekTimetable(week, {cityId: ids.tokyo, ...filters})).days.flatMap(day => day.entries.map(entry => entry.eventId.replace(run + '-', '') + '/' + entry.weekday));
  const swing = styleFilter(styles, ids.swing);
  assert.deepEqual([...swing!].sort(), [ids.lindy, ids.swing].sort(), 'the parent style includes its sub-styles');
  assert.deepEqual(await keys({styleIds: swing!}), ['e1/1', 'e1/3']);
  assert.deepEqual(await keys({styleIds: styleFilter(styles, ids.tango)!}), ['e2/3']);
  assert.equal(styleFilter(styles, 'no-such-style'), null);
  assert.equal(styleFilter(styles, ''), undefined);
  assert.deepEqual(await keys({styleIds: []}), [], 'an unknown style means nothing, not everything');
  assert.deepEqual(await keys({levels: ['OPEN']}), ['e2/3']);
  assert.deepEqual(await keys({levels: ['BEGINNER', 'OPEN']}), ['e1/1', 'e2/3', 'e1/3']);
  assert.deepEqual(await keys({weekdays: [1]}), ['e1/1']);
  assert.deepEqual(await keys({dayPart: 'evening'}), ['e1/3']);
  assert.deepEqual(await keys({dayPart: 'morning'}), ['e1/1']);
  assert.deepEqual(await keys({dayPart: 'afternoon'}), ['e2/3']);
  assert.deepEqual(await keys({profileId: ids.school}), ['e1/1', 'e1/3']);
  assert.deepEqual(await keys({profileId: ids.owned}), []);
});
test('schools: directory with unclaimed stubs, specials, venues and safe JSON-LD', async () => {
  const now = at('2030-06-01T00:00:00Z'), {schools} = await listSchools(ids.tokyo, now);
  assert.deepEqual(schools.map(school => [school.handle, school.unclaimed, school.classes]), [[ids.owned, false, 0], [ids.school, true, 1]]);
  assert.equal((await listSchools(ids.york, now)).schools.length, 0);
  const school = await findSchool(ids.school.toUpperCase());
  assert.ok(school);
  assert.equal('lat' in school, false);
  assert.equal(await findSchool(ids.reader), null);
  const specials = await upcomingSpecials(ids.school, now);
  assert.deepEqual(specials.map(item => item.id), [id('e6'), id('e5'), id('d3')], 'one-off class and workshops, soonest first, never the weekly class');
  assert.deepEqual((await upcomingSpecials(ids.school, at('2030-06-13T11:00:00Z'))).map(item => item.id), [id('d3')], 'past dates drop out');
  const venues = await schoolVenues(ids.school, now);
  assert.deepEqual(venues.map(venue => venue.name), ['Test Hall']);
  const origin = 'https://dance.example', data = schoolJsonLd(school, venues, origin, origin + '/en/schools/' + school.handle), json = safeJson(data);
  assert.equal(data['@type'], 'DanceSchool');
  assert.equal(data.url, origin + '/en/schools/' + school.handle);
  assert.equal(data.location?.[0].address.streetAddress, '1 Swing St');
  assert.equal(json.includes('<'), false, 'no "<" survives, so the name cannot close the script element');
  assert.equal(JSON.parse(json).name, school.name);
});
const row = (key: string, startsAt: string, extra: Partial<DigestRow['event']> = {}): DigestRow => ({startsAt: at(startsAt), event: {id: key, slug: key, title: key, kind: 'CLASS', level: 'OPEN',
  priceText: null, timezone: 'UTC', cityId: 'c1', city: {name: 'City'}, venue: null, styles: [], members: [], ...extra}});
test('digest selection: one line per event, reasons, cap by relevance, days in the event zone', () => {
  const follows = {cityIds: ['c1'], styleIds: ['s1'], profileIds: ['p1']};
  const picked = selectDigestEvents([
    row('a', '2031-03-04T10:00:00Z', {styles: [{styleId: 's1'}]}), row('b', '2031-03-04T12:00:00Z', {cityId: 'c2'}),
    row('c', '2031-03-05T01:00:00Z', {cityId: 'c2', timezone: 'America/New_York', members: [{profileId: 'p1'}]}),
    row('a', '2031-03-06T10:00:00Z', {styles: [{styleId: 's1'}]}), row('d', '2031-03-05T09:00:00Z', {venue: {name: 'Hidden hall', hiddenAt: new Date()}})], follows);
  assert.equal(picked.shown, 3);
  assert.equal(picked.more, 0);
  assert.deepEqual(picked.days.map(day => [day.date, day.events.map(event => event.eventId)]), [['2031-03-04', ['a', 'c']], ['2031-03-05', ['d']]]);
  const [a, c] = picked.days[0].events;
  assert.deepEqual([a.reasons, a.extraDates], [['city', 'style'], 1], 'matched twice, listed once, second date counted');
  assert.deepEqual([c.reasons, c.date], [['profile'], '2031-03-04'], '01:00 UTC on the 5th is the evening of the 4th in New York');
  assert.equal(picked.days[1].events[0].venue, null, 'a hidden venue is not named');
  // 25 city events and one later event that matches city and style: the cap keeps the double match and the 19 earliest.
  const many = [...Array.from({length: 25}, (_, index) => row('m' + String(index).padStart(2, '0'), '2031-03-04T' + String(index % 24).padStart(2, '0') + ':00:00Z')),
    row('z', '2031-03-09T10:00:00Z', {styles: [{styleId: 's1'}]})].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  const capped = selectDigestEvents(many, follows);
  assert.deepEqual([capped.shown, capped.more], [20, 6]);
  assert.equal(capped.days.at(-1)!.events.at(-1)!.eventId, 'z');
  assert.deepEqual(selectDigestEvents([row('x', '2031-03-04T10:00:00Z', {cityId: 'other'})], follows), {days: [], shown: 0, more: 0});
});
const NOW = at('2031-03-03T06:00:00Z');
test('digest content: followed city, style branch and profile, de-duplicated; empty and opted-out accounts are skipped', async () => {
  const digest = await buildDigest(ids.reader, NOW);
  assert.ok(digest);
  assert.deepEqual([digest.email, digest.locale, digest.place, digest.shown, digest.more], [mail('reader'), 'ru', 'Testokyo', 3, 0]);
  assert.deepEqual(digest.days.map(day => [day.date, day.events.map(event => event.eventId.replace(run + '-', ''))]), [['2031-03-04', ['d1', 'd2']], ['2031-03-08', ['d3']]]);
  const [d1, d2] = digest.days[0].events, d3 = digest.days[1].events[0];
  assert.deepEqual([d1.reasons, d1.extraDates, d1.venue, d1.priceText], [['city', 'style'], 1, 'Test Hall', '5 €']);
  assert.deepEqual(d2.reasons, ['style'], 'following the parent style finds an event tagged with the sub-style');
  assert.deepEqual(d3.reasons, ['profile']);
  // d4 draft, d5 beyond seven days, d6 hidden, d7 cancelled, d8 an unfollowed style elsewhere.
  assert.equal(await buildDigest(ids.lonely, NOW), null, 'nothing happening: no digest');
  assert.equal(await buildDigest(ids.off, NOW), null, 'opt-in only');
  assert.equal(await buildDigest(ids.unverified, NOW), null, 'unverified address');
  assert.equal(await buildDigest(ids.owner, NOW), null, 'no preference row means off');
  assert.equal(await buildDigest('missing-user', NOW), null);
  await db.user.update({where: {id: ids.reader}, data: {bannedAt: new Date()}});
  assert.equal(await buildDigest(ids.reader, NOW), null, 'banned');
  await db.user.update({where: {id: ids.reader}, data: {bannedAt: null}});
});
test('unsubscribe token: verifies its own user, rejects tampering and other secrets', () => {
  const token = unsubscribeToken(ids.reader);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyUnsubscribeToken(token), ids.reader);
  assert.equal(unsubscribeToken(ids.reader), token, 'stable: old emails keep working');
  const [payload, signature] = token.split('.');
  const other = Buffer.from(ids.off).toString('base64url');
  for (const forged of [other + '.' + signature, payload + '.' + signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A'), payload + '.', payload, '', token + 'x', 'a.b.c', payload + '=.' + signature,
    token.toUpperCase(), 'x'.repeat(500)]) assert.equal(verifyUnsubscribeToken(forged), null, forged.slice(0, 40));
  assert.equal(verifyUnsubscribeToken(null), null);
  const secret = process.env.BETTER_AUTH_SECRET;
  try {
    process.env.BETTER_AUTH_SECRET = 'another-secret';
    assert.equal(verifyUnsubscribeToken(token), null);
    delete process.env.BETTER_AUTH_SECRET;
    assert.throws(() => unsubscribeToken(ids.reader), /BETTER_AUTH_SECRET/);
  } finally {process.env.BETTER_AUTH_SECRET = secret;}
});
test('digest email is written in the recipient language, escaped, with one-click unsubscribe and no remote content', async () => {
  const digest = (await buildDigest(ids.reader, NOW))!, message = renderDigest(digest), token = unsubscribeToken(ids.reader);
  assert.equal(message.to, mail('reader'));
  assert.equal(message.subject, 'Эта неделя: Testokyo · Dance Community');
  for (const part of [courseText('ru', 'digestIntro'), 'Отписаться в один клик', '/ru/unsubscribe?token=' + token, '/ru/events/' + id('d1') + '?date=', '<b>Jam</b> & Co', 'Test Hall, Testokyo', '5 €',
    'ещё дат на этой неделе: 1', 'ВТОРНИК, 4 МАРТА', '/ru/calendar', '/ru/settings'])
    assert.ok(message.text.includes(part), 'text: ' + part);
  // 10:00 UTC is 19:00 in Tokyo; 01:00 UTC on the 5th is 20:00 on the 4th in New York.
  assert.match(message.text, /19:00 GMT\+9 — <b>Jam<\/b> & Co/);
  assert.match(message.text, /20:00 GMT-5 — Event d2/);
  assert.equal(message.html.includes('<b>Jam'), false, 'user text is escaped in HTML');
  assert.ok(message.html.includes('&#60;b&#62;Jam&#60;/b&#62; &#38; Co'));
  assert.ok(message.html.includes('lang="ru"'));
  for (const remote of ['<img', '<script', '<link', 'background:url', 'src=']) assert.equal(message.html.includes(remote), false, remote);
  const links = [...message.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  assert.ok(links.length >= 5);
  for (const link of links) assert.ok(link.startsWith(origin + '/ru/'), 'only direct same-site links, no tracking redirects: ' + link);
  assert.equal(message.headers['List-Unsubscribe'], '<' + origin + '/api/digest/unsubscribe?token=' + token + '>');
  assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const english = renderDigest({...digest, locale: 'en', place: null, more: 4}), spanish = renderDigest({...digest, locale: 'es'}), fallback = renderDigest({...digest, locale: 'de'});
  assert.equal(english.subject, 'Your dance week · Dance Community');
  assert.ok(english.text.includes('More events this week: 4.'));
  assert.ok(english.text.includes('TUESDAY, MARCH 4') || english.text.includes('TUESDAY, 4 MARCH'));
  assert.equal(spanish.subject, 'Esta semana en Testokyo · Dance Community');
  assert.ok(spanish.text.includes('Darse de baja con un clic') && spanish.text.includes('/es/unsubscribe?token='));
  assert.equal(fallback.subject, 'This week in Testokyo · Dance Community', 'unknown locales fall back to English');
});
test('weekly claim is atomic: concurrent workers send exactly one digest per ISO week', async () => {
  assert.equal(digestWeekStart(NOW).toISOString(), '2031-03-03T00:00:00.000Z');
  assert.equal(digestWeekStart(at('2031-03-09T23:59:59Z')).toISOString(), '2031-03-03T00:00:00.000Z');
  const sent: DigestMail[] = [], deliver = async (message: DigestMail) => {await new Promise(resolve => setTimeout(resolve, 20)); sent.push(message);};
  const outcomes = await Promise.all(Array.from({length: 8}, () => sendDigest(ids.reader, NOW, deliver)));
  assert.deepEqual(outcomes.filter(outcome => outcome === 'sent').length, 1);
  assert.deepEqual(outcomes.filter(outcome => outcome === 'already').length, 7);
  assert.equal(sent.length, 1);
  assert.equal((await db.notificationPreference.findUnique({where: {userId: ids.reader}}))?.digestSentAt?.toISOString(), NOW.toISOString());
  // Later in the same ISO week: nothing more. The next Monday: a new digest (d5 is now inside the window).
  assert.equal(await sendDigest(ids.reader, at('2031-03-07T07:00:00Z'), deliver), 'already');
  const claims = await Promise.all(Array.from({length: 6}, () => claimDigest(ids.reader, at('2031-03-10T07:00:00Z'))));
  assert.equal(claims.filter(claim => claim.claimed).length, 1);
  assert.equal(claims.find(claim => claim.claimed)?.previous?.toISOString(), NOW.toISOString());
  assert.equal((await claimDigest(ids.off, NOW)).claimed, false, 'an opted-out account can never be claimed');
  assert.equal((await claimDigest('missing-user', NOW)).claimed, false);
  // Empty digest: nothing is claimed, so "digestSentAt" only ever means a real email.
  assert.equal(await sendDigest(ids.lonely, NOW, deliver), 'empty');
  assert.equal((await db.notificationPreference.findUnique({where: {userId: ids.lonely}}))?.digestSentAt, null);
  assert.equal(sent.length, 1);
  // A failed delivery gives the claim back so the retry can send it.
  const previous = at('2031-02-24T07:00:00Z');
  await db.notificationPreference.update({where: {userId: ids.reader}, data: {digestSentAt: previous}});
  assert.equal(await sendDigest(ids.reader, NOW, async () => {throw new Error('SMTP down');}), 'failed');
  assert.equal((await db.notificationPreference.findUnique({where: {userId: ids.reader}}))?.digestSentAt?.toISOString(), previous.toISOString());
  assert.equal(await sendDigest(ids.reader, NOW, deliver), 'sent');
  assert.equal(sent.length, 2);
});
test('weekly run fans out over subscribers only and really sends through SMTP (Mailpit)', async t => {
  await db.notificationPreference.update({where: {userId: ids.reader}, data: {digestSentAt: null}});
  const users = [ids.reader, ids.lonely, ids.off, ids.unverified, ids.owner];
  // Two runs at once, as two workers would do; batch size 1 exercises the cursor.
  const [first, second] = await Promise.all([sendWeeklyDigests(NOW, {userIds: users, batch: 1}), sendWeeklyDigests(NOW, {userIds: users, batch: 1})]);
  assert.equal(first.sent + second.sent, 1, 'exactly one email for the one account with something to read');
  assert.equal(first.failed + second.failed, 0);
  assert.ok(first.candidates <= 2 && second.candidates <= 2, 'opted-out and unverified accounts are not even candidates');
  assert.deepEqual(await sendWeeklyDigests(NOW, {userIds: users}), {candidates: 1, sent: 0, empty: 1, already: 0, failed: 0}, 'a repeated run sends nothing');
  let found: {messages?: {ID: string; Subject: string}[]};
  try {found = await (await fetch('http://127.0.0.1:8025/api/v1/search?query=' + encodeURIComponent('to:' + mail('reader')))).json();}
  catch {t.diagnostic('Mailpit API not reachable: delivery was not inspected'); return;}
  assert.equal(found.messages?.length, 1, 'one message in the mailbox');
  assert.equal(found.messages![0].Subject, 'Эта неделя: Testokyo · Dance Community');
  const headers: Record<string, string[]> = await (await fetch('http://127.0.0.1:8025/api/v1/message/' + found.messages![0].ID + '/headers')).json();
  assert.match(headers['List-Unsubscribe']?.[0] || '', /^<http.+\/api\/digest\/unsubscribe\?token=.+>$/);
  assert.equal(headers['List-Unsubscribe-Post']?.[0], 'List-Unsubscribe=One-Click');
  assert.match(headers['Content-Type']?.[0] || '', /multipart\/alternative/);
});
test('unsubscribe endpoint flips the switch with a valid token only; subscription helper is an upsert', async () => {
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin, url = origin + '/api/digest/unsubscribe';
  assert.deepEqual(await digestSubscription(ids.reader), {enabled: true});
  const bad = await unsubscribePost(new Request(url + '?token=' + unsubscribeToken(ids.reader).slice(0, -2) + 'zz', {method: 'POST'}));
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), {error: 'INVALID_TOKEN'});
  assert.equal((await unsubscribePost(new Request(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"token":5}'}))).status, 400);
  assert.equal((await unsubscribePost(new Request(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'}))).status, 400);
  assert.deepEqual(await digestSubscription(ids.reader), {enabled: true});
  // RFC 8058 one-click: the mail client POSTs "List-Unsubscribe=One-Click" to the header URL, without cookies or Origin.
  const oneClick = await unsubscribePost(new Request(url + '?token=' + unsubscribeToken(ids.reader), {method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'List-Unsubscribe=One-Click'}));
  assert.equal(oneClick.status, 200);
  assert.deepEqual(await oneClick.json(), {enabled: false});
  assert.deepEqual(await digestSubscription(ids.reader), {enabled: false});
  assert.equal(await buildDigest(ids.reader, NOW), null);
  // The confirmation page posts JSON; repeating it is harmless.
  await setDigestSubscription(ids.reader, true);
  const page = await unsubscribePost(new Request(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: unsubscribeToken(ids.reader)})}));
  assert.equal(page.status, 200);
  assert.deepEqual(await digestSubscription(ids.reader), {enabled: false});
  // A token for a deleted account answers the same and creates nothing.
  assert.equal((await unsubscribePost(new Request(url + '?token=' + unsubscribeToken(run + '-gone'), {method: 'POST'}))).status, 200);
  assert.equal(await db.notificationPreference.findUnique({where: {userId: run + '-gone'}}), null);
  // Opting in creates the preference row when there is none.
  assert.deepEqual(await setDigestSubscription(ids.owner, true), {enabled: true});
  assert.deepEqual(await digestSubscription(ids.owner), {enabled: true});
});
test('job registry: unique names, valid schedules, the expected jobs', async () => {
  assert.deepEqual(registryProblems(), []);
  assert.equal(new Set(jobs.map(job => job.name)).size, jobs.length);
  const byName = new Map(jobs.map(job => [job.name, job]));
  assert.equal(byName.get('digest.weekly')?.cron, '0 7 * * 1');
  assert.equal(byName.get('reminders.events')?.everyMs, 5 * 60_000);
  for (const name of ['media.sweep', 'ratelimit.cleanup']) assert.ok(byName.get(name)?.cron, name);
  for (const job of jobs) {
    assert.equal(typeof job.handler, 'function');
    // On-demand jobs (import.source) have no schedule; nothing may have two.
    assert.ok(!(job.cron !== undefined && job.everyMs !== undefined), job.name + ' has at most one schedule');
  }
  for (const good of ['0 7 * * 1', '*/5 * * * *', '15 4 * * *', '0 0 1 1 0', '0,30 8-18/2 * * 1-5']) assert.equal(validCron(good), true, good);
  for (const bad of ['', '* * * *', '60 7 * * 1', '0 24 * * *', '0 7 * * 8', '0 7 0 * *', '*/0 * * * *', '0 7 * * MON', '5-1 * * * *', '0 7 * * 1 *']) assert.equal(validCron(bad), false, bad);
  const noop = async () => null;
  assert.deepEqual(registryProblems([{name: 'a.b', cron: '0 7 * * 1', handler: noop}, {name: 'a.b', everyMs: 500, handler: noop}, {name: 'Bad', cron: 'x', everyMs: 5000, attempts: 0, handler: noop}]).length, 6);
  // The reminders feature is loaded lazily; a missing module is tolerated, anything else is not.
  assert.equal(typeof await loadReminders(), 'function');
  assert.equal(await loadReminders('../notifications/not-there-' + run), null);
});
test('cleanup job removes only stale rows', async () => {
  const now = new Date(), days = (count: number) => new Date(now.getTime() - count * 86400_000);
  await db.rateLimit.createMany({data: [{id: id('rl-old'), key: id('rl-old'), count: 3, lastRequest: BigInt(days(2).getTime())}, {id: id('rl-new'), key: id('rl-new'), count: 3, lastRequest: BigInt(now.getTime())}]});
  await db.verification.createMany({data: [{id: id('v-old'), identifier: id('v'), value: 'x', expiresAt: days(2)}, {id: id('v-recent'), identifier: id('v'), value: 'x', expiresAt: new Date(now.getTime() - 3600_000)},
    {id: id('v-live'), identifier: id('v'), value: 'x', expiresAt: new Date(now.getTime() + 3600_000)}]});
  await db.notification.createMany({data: [
    {id: id('n-old-read'), userId: ids.owner, type: 'TEST', data: {}, readAt: days(95), createdAt: days(100)},
    {id: id('n-old-unread'), userId: ids.owner, type: 'TEST', data: {}, createdAt: days(100)},
    {id: id('n-new-read'), userId: ids.owner, type: 'TEST', data: {}, readAt: days(1), createdAt: days(10)}]});
  await db.eventInvite.createMany({data: [
    {id: id('i-expired'), eventId: id('e1'), token: id('i-expired'), invitedByProfileId: ids.owned, email: mail('a'), expiresAt: days(1)},
    {id: id('i-accepted'), eventId: id('e1'), token: id('i-accepted'), invitedByProfileId: ids.owned, email: mail('b'), expiresAt: days(1), acceptedAt: days(3)},
    {id: id('i-live'), eventId: id('e1'), token: id('i-live'), invitedByProfileId: ids.owned, email: mail('c'), expiresAt: new Date(now.getTime() + 86400_000)}]});
  const result = await cleanupStaleRows(now);
  assert.ok(result.rateLimits >= 1 && result.verifications >= 1 && result.notifications >= 1 && result.invites >= 1, JSON.stringify(result));
  const left = async () => [
    ...(await db.rateLimit.findMany({where: {id: {startsWith: run}}, select: {id: true}})), ...(await db.verification.findMany({where: {id: {startsWith: run}}, select: {id: true}})),
    ...(await db.notification.findMany({where: {id: {startsWith: run}}, select: {id: true}})), ...(await db.eventInvite.findMany({where: {id: {startsWith: run}}, select: {id: true}}))]
    .map(item => item.id.replace(run + '-', '')).sort();
  assert.deepEqual(await left(), ['i-accepted', 'i-live', 'n-new-read', 'n-old-unread', 'rl-new', 'v-live', 'v-recent']);
  assert.deepEqual(await cleanupStaleRows(now), {rateLimits: 0, verifications: 0, notifications: 0, invites: 0}, 'a second run finds nothing');
  await db.rateLimit.deleteMany({where: {id: {startsWith: run}}});
  await db.verification.deleteMany({where: {id: {startsWith: run}}});
});
test('media sweep deletes abandoned raw uploads older than a day, nothing else', async () => {
  const saved = {storage: process.env.MEDIA_STORAGE, dir: process.env.MEDIA_LOCAL_DIR}, root = await mkdtemp(join(tmpdir(), 'courses-media-'));
  try {
    process.env.MEDIA_STORAGE = 'local'; process.env.MEDIA_LOCAL_DIR = root;
    const uuid = () => randomUUID(), old = new Date(Date.now() - 25 * 3600_000);
    const files = {stale: 'raw/profile1/event/event1/' + uuid(), fresh: 'raw/profile1/avatar/_/' + uuid(), odd: 'raw/notes.txt', image: 'img/profile1/' + uuid() + '/320.webp'};
    for (const key of Object.values(files)) {
      await mkdir(join(root, ...key.split('/').slice(0, -1)), {recursive: true});
      await writeFile(join(root, ...key.split('/')), 'x');
    }
    for (const key of [files.stale, files.odd, files.image]) await utimes(join(root, ...key.split('/')), old, old);
    assert.deepEqual(await sweepRawUploads(), {driver: 'local', scanned: 3, deleted: 1});
    assert.deepEqual(Object.fromEntries(Object.entries(files).map(([name, key]) => [name, existsSync(join(root, ...key.split('/')))])), {stale: false, fresh: true, odd: true, image: true});
    assert.deepEqual(await sweepRawUploads(), {driver: 'local', scanned: 2, deleted: 0});
    process.env.MEDIA_LOCAL_DIR = join(root, 'nothing-here');
    assert.deepEqual(await sweepRawUploads(), {driver: 'local', scanned: 0, deleted: 0});
  } finally {
    if (saved.storage === undefined) delete process.env.MEDIA_STORAGE; else process.env.MEDIA_STORAGE = saved.storage;
    if (saved.dir === undefined) delete process.env.MEDIA_LOCAL_DIR; else process.env.MEDIA_LOCAL_DIR = saved.dir;
    await rm(root, {recursive: true, force: true});
  }
});
const worker = (args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), join('src', 'worker', 'index.ts'), ...args], {encoding: 'utf8', timeout: 60_000, env: {...process.env, ...env}});
  const lines = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as Record<string, unknown>);
  return {status: result.status, lines, stderr: result.stderr};
};
test('worker entrypoint: --list, --once and an unknown job', () => {
  const list = worker(['--list']);
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.lines.map(line => line.job), jobs.map(job => job.name));
  assert.ok(list.lines.every(line => line.level === 'info' && line.service === 'worker' && typeof line.schedule === 'string'));
  const once = worker(['--once', 'ratelimit.cleanup']);
  assert.equal(once.status, 0, once.stderr);
  assert.deepEqual(once.lines.map(line => line.event), ['job_started', 'job_completed']);
  assert.deepEqual(Object.keys(once.lines[1].result as object).sort(), ['invites', 'notifications', 'rateLimits', 'verifications']);
  const unknown = worker(['--once', 'no.such-job']);
  assert.equal(unknown.status, 2);
  assert.ok(unknown.stderr.includes('job_unknown'));
});
test('worker boots on Redis, schedules its jobs once, writes a heartbeat and stops cleanly', async t => {
  if (!process.env.REDIS_URL) {t.skip('REDIS_URL is not set'); return;}
  const queueName = 'test-' + run, env = {WORKER_QUEUE: queueName, WORKER_JOBS: 'ratelimit.cleanup,media.sweep'};
  const redis = new Redis(process.env.REDIS_URL, {maxRetriesPerRequest: 2}), queue = new Queue(queueName, {connection: {url: process.env.REDIS_URL, maxRetriesPerRequest: null}});
  try {
    // A schedule left behind by an older release must disappear on boot.
    await queue.upsertJobScheduler('legacy.job', {every: 3600_000}, {name: 'legacy.job'});
    await redis.del(HEARTBEAT_KEY);
    const first = worker(['--exit-after', '2'], env);
    assert.equal(first.status, 0, first.stderr);
    const events = first.lines.map(line => line.event);
    for (const expected of ['schedule_removed', 'schedule_set', 'worker_ready', 'worker_stopping', 'worker_stopped']) assert.ok(events.includes(expected), expected + ' in ' + events.join(','));
    assert.deepEqual(first.lines.find(line => line.event === 'schedule_removed')?.job, 'legacy.job');
    assert.deepEqual(first.lines.find(line => line.event === 'worker_ready')?.jobs, ['media.sweep', 'ratelimit.cleanup']);
    const beat = JSON.parse(await redis.get(HEARTBEAT_KEY) || '{}');
    assert.equal(beat.queue, queueName);
    assert.ok(Date.now() - Date.parse(beat.at) < 60_000);
    const ttl = await redis.ttl(HEARTBEAT_KEY);
    assert.ok(ttl > 0 && ttl <= 90, 'the heartbeat expires on its own: ' + ttl);
    // A second boot updates the same schedules instead of adding duplicates.
    const second = worker(['--exit-after', '1'], env);
    assert.equal(second.status, 0, second.stderr);
    const schedulers = await queue.getJobSchedulers(0, -1);
    assert.deepEqual(schedulers.map(item => item.key).sort(), ['media.sweep', 'ratelimit.cleanup']);
    assert.deepEqual(schedulers.map(item => [item.pattern, item.tz]).sort(), [['15 4 * * *', 'UTC'], ['30 3 * * *', 'UTC']]);
    assert.equal(typeof DEAD_LETTER_KEY, 'string');
  } finally {
    await queue.obliterate({force: true}).catch(() => {});
    await queue.close();
    await redis.quit();
  }
});
