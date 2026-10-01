import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {config} from 'dotenv';
import {DateTime} from 'luxon';
import {eventAbility} from '../src/lib/permissions';
import {schedule, parseRecurrence, previewDates} from '../src/lib/schedule';
import {canSeeAttendees} from '../src/lib/events/attendees';
import {sameWallClock, zonedLabel} from '../src/lib/events/time';
import {eventJsonLd, safeJson, offsetIso} from '../src/lib/events/jsonld';
import {newShortCode, shortCodePattern, preferredLocale} from '../src/lib/events/short-code';
import {eventInput, inviteInput, artistInput} from '../src/lib/events/schema';
import {eventSearch} from '../src/lib/event-search';
config({path: '../../.env', quiet: true});
// Modules that open the database or the mail transport are loaded after the environment, inside before().
type Db = typeof import('@dance/db')['db'];
let db: Db;
let invites: typeof import('../src/lib/events/invites');
let attendees: typeof import('../src/lib/events/attendees');
let cancel: typeof import('../src/lib/events/cancel');
let codes: typeof import('../src/lib/events/short-code');
let artists: typeof import('../src/lib/events/artists');
let input: typeof import('../src/lib/event-input');
let ApiError: typeof import('../src/lib/api')['ApiError'];
const tag = randomUUID().slice(0, 8), mailpit = 'http://127.0.0.1:8025';
const cityId = 'e4-city-' + tag, otherCityId = 'e4-other-' + tag, styleId = 'e4-style-' + tag;
type Person = {userId: string; profileId: string; email: string; handle: string; name: string};
const people: Record<string, Person> = {};
const eventIds: string[] = [];
const address = (name: string) => 'e4-' + name + '-' + tag + '@example.test';
async function person(name: string, options: {locale?: string; emailEvents?: boolean; verified?: boolean} = {}) {
  const userId = 'e4-' + name + '-' + tag, email = address(name), handle = 'e4-' + name + '-' + tag;
  await db.user.create({data: {id: userId, name: 'Test ' + name, email, emailVerified: options.verified ?? true, ageConfirmed: true, locale: options.locale || 'en',
    ...(options.emailEvents === undefined ? {} : {notificationPreference: {create: {emailEvents: options.emailEvents}}})}});
  const profile = await db.profile.create({data: {userId, type: 'DANCER', handle, name: 'Test ' + name, cityId}});
  return people[name] = {userId, profileId: profile.id, email, handle, name: profile.name};
}
const asUser = (p: Person, verified = true) => ({id: p.userId, email: p.email, emailVerified: verified, profile: {id: p.profileId}});
async function makeEvent(overrides: Record<string, unknown> = {}, weeks = 3) {
  const start = DateTime.fromObject({year: 2031, month: 3, day: 4, hour: 19}, {zone: 'Europe/Madrid'});
  const event = await db.event.create({data: {slug: 'e4-' + randomUUID(), title: 'Weekly swing ' + tag, description: 'Test event for the E4 suite.',
    startsAt: start.toJSDate(), endsAt: start.plus({hours: 3}).toJSDate(), timezone: 'Europe/Madrid', cityId, status: 'PUBLISHED',
    rrule: weeks > 1 ? 'FREQ=WEEKLY;COUNT=' + weeks : null, members: {create: {profileId: people.owner.profileId, role: 'OWNER'}},
    occurrences: {create: Array.from({length: weeks}, (_, i) => ({startsAt: start.plus({weeks: i}).toJSDate(), endsAt: start.plus({weeks: i, hours: 3}).toJSDate()}))},
    ...overrides}, include: {members: true, occurrences: {orderBy: {startsAt: 'asc'}}}});
  eventIds.push(event.id);
  return event;
}
async function rejects(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (error: unknown) => error instanceof ApiError && error.code === code, 'expected ' + code);
}
async function mailTo(email: string, wait = 3000) {
  for (let waited = 0; waited <= wait; waited += 250) {
    const found = await (await fetch(mailpit + '/api/v1/search?query=' + encodeURIComponent('to:"' + email + '"'))).json();
    if (found.messages?.length) return found.messages as {ID: string; Subject: string}[];
    await sleep(250);
  }
  return [];
}
let mailpitUp = false;
before(async () => {
  ({db} = await import('@dance/db'));
  ({ApiError} = await import('../src/lib/api'));
  invites = await import('../src/lib/events/invites');
  attendees = await import('../src/lib/events/attendees');
  cancel = await import('../src/lib/events/cancel');
  codes = await import('../src/lib/events/short-code');
  artists = await import('../src/lib/events/artists');
  input = await import('../src/lib/event-input');
  mailpitUp = await fetch(mailpit + '/api/v1/info', {signal: AbortSignal.timeout(1500)}).then(r => r.ok, () => false);
  await db.city.createMany({data: [{id: cityId, slug: cityId, name: 'Test City', countryCode: 'ES', timezone: 'Europe/Madrid', lat: 40.4, lng: -3.7},
    {id: otherCityId, slug: otherCityId, name: 'Other City', countryCode: 'US', timezone: 'America/New_York', lat: 40.7, lng: -74}]});
  await db.danceStyle.create({data: {id: styleId, slug: styleId, name: 'Test style'}});
  for (const name of ['owner', 'co', 'stranger']) await person(name);
  await person('going', {locale: 'ru'});
  await person('interested', {locale: 'es', emailEvents: false});
  await person('quiet');
  await person('invitee');
});
after(async () => {
  if (!db) return;
  await db.event.deleteMany({where: {id: {in: eventIds}}});
  await db.venue.deleteMany({where: {cityId: {in: [cityId, otherCityId]}}});
  await db.profile.deleteMany({where: {cityId: {in: [cityId, otherCityId]}}});
  await db.user.deleteMany({where: {email: {endsWith: '-' + tag + '@example.test'}}});
  await db.danceStyle.deleteMany({where: {id: styleId}});
  await db.city.deleteMany({where: {id: {in: [cityId, otherCityId]}}});
  if (mailpitUp) {
    const ids: string[] = [];
    for (const email of [...Object.values(people).map(p => p.email), address('nobody')]) ids.push(...(await mailTo(email, 0)).map(m => m.ID));
    if (ids.length) await fetch(mailpit + '/api/v1/messages', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({IDs: ids})});
  }
  await db.$disconnect();
});

test('permission matrix: owner and co-organizer manage; only the owner deletes or changes the team', () => {
  const members = [{profileId: 'owner', role: 'OWNER'}, {profileId: 'co', role: 'CO_ORGANIZER'}, {profileId: 'artist', role: 'ARTIST'}, {profileId: 'guest', role: 'ATTENDEE'}];
  const matrix: Record<string, [boolean, boolean, boolean]> = {owner: [true, true, true], co: [true, false, false], artist: [false, false, false], guest: [false, false, false], nobody: [false, false, false]};
  for (const [who, [manage, remove, team]] of Object.entries(matrix)) {
    const ability = eventAbility(who, members);
    assert.equal(ability.can('manage', 'Event'), manage, who + ' manage');
    assert.equal(ability.can('delete', 'Event'), remove, who + ' delete');
    assert.equal(ability.can('team', 'Event'), team, who + ' team');
  }
  for (const action of ['manage', 'delete', 'team']) assert.equal(eventAbility(undefined, members).can(action, 'Event'), false);
  // A role on another event gives nothing here.
  assert.equal(eventAbility('owner', [{profileId: 'someone', role: 'OWNER'}]).can('manage', 'Event'), false);
});

test('weekly series on several weekdays keeps the local hour across the DST change', () => {
  // Sunday 18 October 2026, 19:00 in Madrid; clocks go back on 25 October.
  const result = schedule('2026-10-18T19:00', '2026-10-18T21:00', 'Europe/Madrid', {count: 6, byDay: ['WE', 'SU']});
  assert.equal(result.rrule, 'FREQ=WEEKLY;BYDAY=WE,SU;COUNT=6');
  assert.deepEqual(result.occurrences.map(o => o.startsAt.toISOString()), [
    '2026-10-18T17:00:00.000Z', '2026-10-21T17:00:00.000Z', '2026-10-25T18:00:00.000Z',
    '2026-10-28T18:00:00.000Z', '2026-11-01T18:00:00.000Z', '2026-11-04T18:00:00.000Z']);
  for (const o of result.occurrences) {
    const local = DateTime.fromJSDate(o.startsAt, {zone: 'Europe/Madrid'});
    assert.equal(local.hour, 19);
    assert.ok([3, 7].includes(local.weekday));
    assert.equal(o.endsAt.getTime() - o.startsAt.getTime(), 2 * 3600000);
  }
  // The weekday of the first date always belongs to the series, even when it is not ticked.
  assert.equal(schedule('2026-10-18T19:00', '2026-10-18T21:00', 'Europe/Madrid', {count: 4, byDay: ['WE']}).rrule, 'FREQ=WEEKLY;BYDAY=WE,SU;COUNT=4');
});

test('every second week, an end date instead of a count, and the stored rule reads back into the form', () => {
  const biweekly = schedule('2026-03-22T20:00', '2026-03-22T23:00', 'Europe/Madrid', {count: 3, interval: 2});
  assert.equal(biweekly.rrule, 'FREQ=WEEKLY;INTERVAL=2;COUNT=3');
  // 22 March is winter time (UTC+1); 5 and 19 April are summer time (UTC+2).
  assert.deepEqual(biweekly.occurrences.map(o => o.startsAt.toISOString()), ['2026-03-22T19:00:00.000Z', '2026-04-05T18:00:00.000Z', '2026-04-19T18:00:00.000Z']);
  const until = schedule('2030-06-03T19:00', '2030-06-03T22:00', 'America/New_York', {until: '2030-06-24', byDay: ['MO', 'TH']});
  assert.equal(until.occurrences.length, 7);
  assert.equal(until.rrule, 'FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20300625T035959Z');
  // The last local day is included: Monday 24 June, 19:00 in New York.
  assert.equal(until.occurrences.at(-1)!.startsAt.toISOString(), '2030-06-24T23:00:00.000Z');
  assert.deepEqual(parseRecurrence(until.rrule, 'America/New_York'), {count: 1, interval: 1, byDay: ['MO', 'TH'], until: '2030-06-24'});
  assert.deepEqual(parseRecurrence(biweekly.rrule, 'Europe/Madrid'), {count: 3, interval: 2, byDay: [], until: null});
  assert.deepEqual(parseRecurrence(null, 'Europe/Madrid'), {count: 1, interval: 1, byDay: [], until: null});
  const once = schedule('2030-06-03T19:00', '2030-06-03T22:00', 'Europe/Madrid', 1);
  assert.equal(once.rrule, null);
  assert.equal(once.occurrences.length, 1);
});

test('the preview shows the first ten dates and is the same computation as materialization', () => {
  const rule = {count: 30, byDay: ['TU', 'FR']};
  const preview = previewDates('2030-01-01T19:00', '2030-01-01T21:00', 'Europe/Moscow', rule);
  assert.equal(preview.length, 10);
  assert.deepEqual(preview, schedule('2030-01-01T19:00', '2030-01-01T21:00', 'Europe/Moscow', rule).occurrences.slice(0, 10).map(o => o.startsAt));
  assert.throws(() => schedule('2030-01-01T19:00', '2030-01-01T21:00', 'Europe/Madrid', {until: '2032-01-01'}), /TOO_MANY_DATES/);
  assert.throws(() => schedule('2030-01-01T19:00', '2030-01-01T21:00', 'Europe/Madrid', {until: '2029-12-01'}), /INVALID_TIME/);
  assert.throws(() => schedule('2030-01-01T19:00', '2030-01-01T21:00', 'Europe/Madrid', {count: 4, interval: 9}), /INVALID_TIME/);
  assert.throws(() => schedule('2030-01-01T19:00', '2030-01-01T21:00', 'Europe/Madrid', {count: 4, byDay: ['XX']}), /INVALID_TIME/);
  // A series whose later date falls into the hour skipped by DST is rejected as a whole, as before.
  assert.throws(() => schedule('2026-03-22T02:30', '2026-03-22T03:30', 'Europe/Madrid', 2), /INVALID_TIME/);
});

test('event input: recurrence, venue, price and attendee privacy are validated; ownership fields are dropped', () => {
  const base = {title: 'Weekly party', description: 'A weekly swing party.', cityId: 'madrid', styleId: 'lindy-hop', startsLocal: '2030-06-14T19:00', endsLocal: '2030-06-14T22:00', status: 'DRAFT'};
  const parsed = eventInput.parse({...base, venueId: '', priceText: ' 10 € ', recurrenceWeeks: '8', recurrenceInterval: '2', recurrenceDays: ['FR', 'SA'], recurrenceUntil: '', lat: 1, shortCode: 'abcdefg', hiddenAt: null});
  assert.equal(parsed.venueId, null);
  assert.equal(parsed.priceText, '10 €');
  assert.equal(parsed.attendeeVisibility, 'PUBLIC');
  assert.deepEqual([parsed.recurrenceWeeks, parsed.recurrenceInterval, parsed.recurrenceDays, parsed.recurrenceUntil], [8, 2, ['FR', 'SA'], null]);
  for (const key of ['lat', 'shortCode', 'hiddenAt']) assert.equal(key in parsed, false);
  assert.equal(eventInput.safeParse({...base, attendeeVisibility: 'SECRET'}).success, false);
  assert.equal(eventInput.safeParse({...base, recurrenceDays: ['MONDAY']}).success, false);
  assert.equal(eventInput.safeParse({...base, recurrenceUntil: '14.06.2030'}).success, false);
  assert.deepEqual(inviteInput.parse({handle: '@Some_Dancer'}), {handle: 'some_dancer'});
  assert.deepEqual(inviteInput.parse({email: ' Friend@Example.TEST '}), {email: 'friend@example.test'});
  assert.equal(inviteInput.safeParse({email: 'not-an-email'}).success, false);
  assert.equal(inviteInput.safeParse({handle: 'ok-handle', role: 'OWNER'}).success, false);
  assert.deepEqual(artistInput.parse({name: ' DJ Test '}), {name: 'DJ Test', type: 'ARTIST'});
  assert.equal(artistInput.safeParse({name: 'Somebody', type: 'DANCER'}).success, false);
  assert.equal(eventSearch({}).hiddenAt, null);
});

test('short codes are 6–8 base32 characters; short links pick the visitor language', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const code = newShortCode();
    assert.match(code, shortCodePattern);
    assert.equal(code.length, 7);
    seen.add(code);
  }
  assert.equal(seen.size, 500);
  for (const length of [6, 8]) assert.match(newShortCode(length), shortCodePattern);
  const locales = ['en', 'es', 'ru'];
  assert.equal(preferredLocale('ru-RU,ru;q=0.9,en;q=0.8', locales, 'en'), 'ru');
  assert.equal(preferredLocale('de-DE,de;q=0.9,es;q=0.6,en;q=0.7', locales, 'en'), 'en');
  assert.equal(preferredLocale('fr;q=1, es-MX;q=0.5, ru;q=0', locales, 'en'), 'es');
  assert.equal(preferredLocale(null, locales, 'en'), 'en');
  assert.equal(preferredLocale('*', locales, 'en'), 'en');
});

test('a short code is given once, survives later publications and a collision is retried', async () => {
  const [first, second] = [await makeEvent({}, 1), await makeEvent({}, 1)];
  const code = await codes.ensureShortCode(first.id);
  assert.match(code!, shortCodePattern);
  assert.equal(await codes.ensureShortCode(first.id), code, 'the code never changes');
  const fresh = newShortCode(), attempts = [code!, code!, fresh];
  assert.equal(await codes.ensureShortCode(second.id, () => attempts.shift()!), fresh);
  assert.equal(attempts.length, 0, 'two collisions were retried');
  await assert.rejects(async () => codes.ensureShortCode((await makeEvent({}, 1)).id, () => code!, 3), /SHORT_CODE_UNAVAILABLE/);
});

test('invite token lifecycle: create, wrong account, accept once, expiry, revoke', async () => {
  const event = await makeEvent(), {owner, co, stranger} = people;
  const now = new Date();
  assert.equal(invites.inviteState({acceptedAt: null, expiresAt: new Date(now.getTime() + 1000)}, now), 'PENDING');
  assert.equal(invites.inviteState({acceptedAt: null, expiresAt: now}, now), 'EXPIRED');
  assert.equal(invites.inviteState({acceptedAt: now, expiresAt: new Date(0)}, now), 'ACCEPTED');
  const invite = await invites.createInvite(event, {profileId: owner.profileId, name: owner.name}, {handle: co.handle}, now);
  assert.match(invite.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(invite.expiresAt.getTime() - now.getTime(), 14 * 86400000);
  const notice = await db.notification.findFirstOrThrow({where: {userId: co.userId, type: 'EVENT_INVITE'}});
  assert.equal((notice.data as {eventId: string}).eventId, event.id);
  assert.equal(notice.url, '/en/invites/' + invite.token);
  assert.deepEqual((await invites.pendingInvites(event.id)).map(i => [i.handle, i.email]), [[co.handle, null]]);
  assert.equal('token' in (await invites.pendingInvites(event.id))[0], false, 'tokens are never listed');
  // Somebody else with the link cannot use it, and it stays valid for the addressee.
  await rejects(() => invites.answerInvite(invite.token, asUser(stranger), 'accept'), 'INVITE_MISMATCH');
  await rejects(() => invites.answerInvite('not-a-token', asUser(co), 'accept'), 'INVITE_INVALID');
  assert.equal(eventAbility(co.profileId, await db.eventMembership.findMany({where: {eventId: event.id}})).can('manage', 'Event'), false);
  assert.deepEqual(await invites.answerInvite(invite.token, asUser(co), 'accept'), {status: 'ACCEPTED', slug: event.slug});
  const members = await db.eventMembership.findMany({where: {eventId: event.id}});
  assert.equal(eventAbility(co.profileId, members).can('manage', 'Event'), true);
  assert.equal(eventAbility(co.profileId, members).can('delete', 'Event'), false);
  // Single use.
  await rejects(() => invites.answerInvite(invite.token, asUser(co), 'accept'), 'INVITE_INVALID');
  assert.deepEqual(await invites.pendingInvites(event.id), []);
  await rejects(() => invites.createInvite(event, {profileId: owner.profileId, name: owner.name}, {handle: co.handle}), 'ALREADY_MEMBER');
  await rejects(() => invites.createInvite(event, {profileId: owner.profileId, name: owner.name}, {handle: 'no-such-' + tag}), 'PROFILE_NOT_FOUND');
  // Expired.
  const old = await invites.createInvite(event, {profileId: owner.profileId, name: owner.name}, {handle: stranger.handle}, new Date(now.getTime() - 15 * 86400000));
  await rejects(() => invites.answerInvite(old.token, asUser(stranger), 'accept'), 'INVITE_INVALID');
  // A new invitation replaces the old one; declining (or revoking) removes it.
  const again = await invites.createInvite(event, {profileId: owner.profileId, name: owner.name}, {handle: stranger.handle});
  assert.equal(await db.eventInvite.count({where: {eventId: event.id, profileId: stranger.profileId}}), 1);
  assert.equal((await invites.answerInvite(again.token, asUser(stranger), 'decline')).status, 'DECLINED');
  await rejects(() => invites.answerInvite(again.token, asUser(stranger), 'accept'), 'INVITE_INVALID');
  assert.equal(await db.eventMembership.count({where: {eventId: event.id, profileId: stranger.profileId}}), 0);
});

test('email invitations look the same for known and unknown addresses and bind to the verified email', async () => {
  const event = await makeEvent(), {owner, quiet} = people, stranger = people.invitee;
  const inviter = {profileId: owner.profileId, name: owner.name, locale: 'es'};
  const known = await invites.createInvite(event, inviter, {email: stranger.email});
  const unknown = await invites.createInvite(event, inviter, {email: address('nobody')});
  // Same shape either way: no handle, the address as typed, a token and an expiry.
  for (const invite of [known, unknown]) assert.deepEqual(Object.keys(invite).sort(), ['email', 'expiresAt', 'handle', 'id', 'token']);
  assert.deepEqual([known.handle, unknown.handle], [null, null]);
  const rows = await db.eventInvite.findMany({where: {eventId: event.id}, orderBy: {createdAt: 'asc'}});
  assert.deepEqual(rows.map(r => [r.email, r.profileId, r.role]), [[stranger.email, null, 'CO_ORGANIZER'], [address('nobody'), null, 'CO_ORGANIZER']]);
  await rejects(() => invites.answerInvite(known.token, asUser(quiet), 'accept'), 'INVITE_MISMATCH');
  await rejects(() => invites.answerInvite(known.token, asUser(stranger, false), 'accept'), 'INVITE_MISMATCH');
  await rejects(() => invites.answerInvite(known.token, {...asUser(stranger), profile: null}, 'accept'), 'PROFILE_REQUIRED');
  assert.equal((await invites.answerInvite(known.token, asUser(stranger), 'accept')).status, 'ACCEPTED');
  assert.equal(await db.eventMembership.count({where: {eventId: event.id, profileId: stranger.profileId, role: 'CO_ORGANIZER'}}), 1);
  if (!mailpitUp) return;
  const [toKnown, toUnknown] = [await mailTo(stranger.email), await mailTo(address('nobody'))];
  assert.equal(toKnown.length, 1);
  assert.equal(toUnknown.length, 1);
  // The account's own language for a member, the inviter's language for an address without an account.
  assert.match(toKnown[0].Subject, /Invitation to co-organize/);
  assert.match(toUnknown[0].Subject, /Invitación para coorganizar/);
});

test('attendee list honours PUBLIC, ATTENDEES and ORGANIZERS; a new "going" notifies organizers once', async () => {
  for (const [visibility, viewer, expected] of [
    ['PUBLIC', {isManager: false, hasRsvp: false}, true], ['ATTENDEES', {isManager: false, hasRsvp: false}, false],
    ['ATTENDEES', {isManager: false, hasRsvp: true}, true], ['ATTENDEES', {isManager: true, hasRsvp: false}, true],
    ['ORGANIZERS', {isManager: false, hasRsvp: true}, false], ['ORGANIZERS', {isManager: true, hasRsvp: false}, true]] as const)
    assert.equal(canSeeAttendees(visibility, viewer), expected, visibility + JSON.stringify(viewer));
  const event = await makeEvent(), {owner, going, interested, quiet, stranger} = people;
  const profile = (p: Person) => ({id: p.profileId, handle: p.handle, name: p.name});
  await attendees.setRsvp(event, profile(going), 'GOING');
  await attendees.setRsvp(event, profile(interested), 'INTERESTED');
  await attendees.setRsvp(event, profile(quiet), 'GOING');
  await attendees.setRsvp(event, profile(quiet), 'DECLINED');
  const view = async (visibility: 'PUBLIC' | 'ATTENDEES' | 'ORGANIZERS', viewer?: Person) => {
    const result = await attendees.listAttendees({...event, attendeeVisibility: visibility}, viewer?.profileId);
    assert.deepEqual([result.going, result.interested], [1, 1], 'the counters are always public');
    return result.visible ? result.attendees.map(a => a.handle + ':' + a.status) : null;
  };
  const everyone = [going.handle + ':GOING', interested.handle + ':INTERESTED'];
  assert.deepEqual(await view('PUBLIC'), everyone);
  assert.deepEqual(await view('PUBLIC', stranger), everyone);
  assert.equal(await view('ATTENDEES'), null);
  assert.equal(await view('ATTENDEES', stranger), null);
  assert.equal(await view('ATTENDEES', quiet), null, 'a withdrawn RSVP does not open the list');
  assert.deepEqual(await view('ATTENDEES', interested), everyone);
  assert.deepEqual(await view('ATTENDEES', owner), everyone);
  assert.equal(await view('ORGANIZERS', going), null);
  assert.deepEqual(await view('ORGANIZERS', owner), everyone);
  // Organizer notifications: one per attendee, not one per click; "interested" alone does not notify.
  await attendees.setRsvp(event, profile(going), 'INTERESTED');
  await attendees.setRsvp(event, profile(going), 'GOING');
  const notices = await db.notification.findMany({where: {userId: owner.userId, type: 'NEW_ATTENDEE', data: {path: ['eventId'], equals: event.id}}});
  assert.deepEqual(notices.map(n => (n.data as {name: string}).name).sort(), [going.name, quiet.name].sort());
  assert.deepEqual(Object.keys(notices[0].data as object).sort(), ['eventId', 'handle', 'name', 'profileId', 'slug', 'title']);
  assert.equal(notices[0].url, '/en/events/' + event.slug);
  // The organizer's own RSVP is not announced to themselves.
  await attendees.setRsvp(event, profile(owner), 'GOING');
  assert.equal(await db.notification.count({where: {userId: owner.userId, type: 'NEW_ATTENDEE', data: {path: ['eventId'], equals: event.id}}}), 2);
});

test('cancellation fan-out: everyone going or interested is notified; email follows preferences and language', async () => {
  const event = await makeEvent(), {owner, going, interested, quiet, stranger} = people;
  await db.rsvp.createMany({data: [{eventId: event.id, profileId: going.profileId, status: 'GOING'}, {eventId: event.id, profileId: interested.profileId, status: 'INTERESTED'},
    {eventId: event.id, profileId: quiet.profileId, status: 'DECLINED'}, {eventId: event.id, profileId: owner.profileId, status: 'GOING'}]});
  const cancelled = (userId: string) => db.notification.findMany({where: {userId, type: 'EVENT_CANCELLED', data: {path: ['eventId'], equals: event.id}}, orderBy: {createdAt: 'asc'}});
  // One date of the series.
  const date = event.occurrences[1];
  const single = await cancel.announceCancellation(event.id, {occurrence: {id: date.id, startsAt: date.startsAt}, exceptUserId: owner.userId});
  assert.deepEqual(single, {notified: 2, mailed: 1});
  const first = (await cancelled(going.userId))[0];
  assert.deepEqual(first.data, {eventId: event.id, slug: event.slug, title: event.title, occurrenceId: date.id, date: date.startsAt.toISOString(), timezone: 'Europe/Madrid'});
  assert.equal(first.url, '/ru/events/' + event.slug + '?date=' + encodeURIComponent(date.startsAt.toISOString()));
  // The whole event.
  assert.deepEqual(await cancel.announceCancellation(event.id, {exceptUserId: owner.userId}), {notified: 2, mailed: 1});
  assert.equal((await cancelled(going.userId)).length, 2);
  assert.deepEqual((await cancelled(interested.userId)).map(n => n.url), ['/es/events/' + event.slug + '?date=' + encodeURIComponent(date.startsAt.toISOString()), '/es/events/' + event.slug]);
  assert.deepEqual((await cancelled(going.userId))[1].data, {eventId: event.id, slug: event.slug, title: event.title});
  for (const p of [quiet, stranger, owner]) assert.equal((await cancelled(p.userId)).length, 0, p.name + ' is not notified');
  if (!mailpitUp) return;
  const subjects = (await mailTo(going.email)).map(m => m.Subject).sort();
  assert.equal(subjects.length, 2);
  assert.match(subjects[0], /^Дата отменена: Weekly swing/);
  assert.match(subjects[1], /^Отменено: Weekly swing/);
  assert.deepEqual(await mailTo(interested.email, 750), [], 'event emails are switched off for this person');
  assert.deepEqual(await mailTo(quiet.email, 250), []);
});

test('saving a series again keeps cancelled dates that did not move; venue coordinates are copied to the event', async () => {
  const event = await makeEvent();
  await db.eventOccurrence.update({where: {id: event.occurrences[1].id}, data: {cancelled: true}});
  const times = event.occurrences.map(o => ({startsAt: o.startsAt, endsAt: new Date(o.endsAt!.getTime() + 1800000)}));
  const extra = {startsAt: new Date(times[2].startsAt.getTime() + 7 * 86400000), endsAt: new Date(times[2].endsAt.getTime() + 7 * 86400000)};
  await db.$transaction(tx => input.syncOccurrences(tx, event.id, [...times.slice(1), extra]));
  const rows = await db.eventOccurrence.findMany({where: {eventId: event.id}, orderBy: {startsAt: 'asc'}});
  assert.deepEqual(rows.map(r => [r.id === event.occurrences[1].id || r.id === event.occurrences[2].id, r.cancelled]), [[true, true], [true, false], [false, false]]);
  assert.equal(rows[0].endsAt!.getTime(), times[1].endsAt.getTime());
  const venue = await db.venue.create({data: {name: 'Test Hall', address: '1 Test Street', cityId, lat: 40.41, lng: -3.71}});
  const foreign = await db.venue.create({data: {name: 'Far Hall', address: '2 Far Street', cityId: otherCityId, lat: 40.7, lng: -74}});
  const body = {title: 'Weekly party', description: 'A weekly swing party.', cityId, styleId, startsLocal: '2031-06-06T20:00', endsLocal: '2031-06-06T23:00', status: 'DRAFT',
    recurrenceWeeks: 4, recurrenceDays: ['FR', 'SA'], priceText: '10 €', attendeeVisibility: 'ATTENDEES'};
  const withVenue = await input.prepareEvent({...body, venueId: venue.id});
  assert.deepEqual([withVenue.fields.venueId, withVenue.fields.lat, withVenue.fields.lng], [venue.id, 40.41, -3.71]);
  assert.deepEqual([withVenue.fields.priceText, withVenue.fields.attendeeVisibility, withVenue.fields.rrule], ['10 €', 'ATTENDEES', 'FREQ=WEEKLY;BYDAY=FR,SA;COUNT=4']);
  assert.equal(withVenue.occurrences.length, 4);
  const cityOnly = await input.prepareEvent(body);
  assert.deepEqual([cityOnly.fields.venueId, cityOnly.fields.lat, cityOnly.fields.lng], [null, 40.4, -3.7]);
  await rejects(() => input.prepareEvent({...body, venueId: foreign.id}), 'INVALID_VENUE');
  await rejects(() => input.prepareEvent({...body, recurrenceWeeks: 1, recurrenceUntil: '2033-06-06'}), 'TOO_MANY_DATES');
});

test('artists: an existing profile by handle, or a stub profile without an owner', async () => {
  const event = await makeEvent(), {stranger} = people;
  assert.equal(artists.stubHandleBase('Dj Ñandú & The Cats!'), 'dj-nandu-the-cats');
  assert.equal(artists.stubHandleBase('Оркестр', 'school'), 'school');
  const existing = await artists.attachArtist(event, {handle: stranger.handle});
  assert.deepEqual([existing.profileId, existing.stub], [stranger.profileId, false]);
  await artists.attachArtist(event, {handle: stranger.handle});
  assert.equal(await db.eventMembership.count({where: {eventId: event.id, role: 'ARTIST'}}), 1, 'attaching twice is idempotent');
  const stub = await artists.attachArtist(event, {name: 'The Test Orchestra', type: 'ARTIST'});
  assert.equal(stub.stub, true);
  assert.match(stub.handle, /^the-test-orchestra-[0-9a-f]{6}$/);
  assert.match(stub.handle, /^[a-z0-9][a-z0-9_-]{2,29}$/);
  const profile = await db.profile.findUniqueOrThrow({where: {id: stub.profileId}});
  assert.deepEqual([profile.userId, profile.type, profile.cityId], [null, 'ARTIST', cityId]);
  // A stub cannot be invited as a co-organizer: nobody could accept.
  await rejects(() => invites.createInvite(event, {profileId: people.owner.profileId, name: 'Owner'}, {handle: stub.handle}), 'PROFILE_NOT_FOUND');
  await rejects(() => artists.attachArtist(event, {handle: 'no-such-' + tag}), 'PROFILE_NOT_FOUND');
  await artists.detachArtist(event.id, stub.profileId);
  assert.equal(await db.profile.count({where: {id: stub.profileId}}), 0, 'an unused stub is removed with its last event');
  await artists.detachArtist(event.id, stranger.profileId);
  assert.equal(await db.profile.count({where: {id: stranger.profileId}}), 1, 'a real profile is only detached');
  await rejects(() => artists.detachArtist(event.id, stranger.profileId), 'NOT_FOUND');
});

test('deleting an event removes its dates, team, invitations and RSVPs', async () => {
  const event = await makeEvent(), {owner, going, stranger} = people;
  await db.rsvp.create({data: {eventId: event.id, profileId: going.profileId, status: 'GOING'}});
  await invites.createInvite(event, {profileId: owner.profileId, name: owner.name}, {handle: stranger.handle});
  await db.event.delete({where: {id: event.id}});
  for (const count of [db.eventOccurrence.count({where: {eventId: event.id}}), db.eventMembership.count({where: {eventId: event.id}}),
    db.eventInvite.count({where: {eventId: event.id}}), db.rsvp.count({where: {eventId: event.id}})]) assert.equal(await count, 0);
  assert.equal(await db.profile.count({where: {id: going.profileId}}), 1);
});

test('a viewer in another time zone sees their own clock; JSON-LD carries the event offset and cannot break out of the script', () => {
  const start = new Date('2030-06-14T17:00:00.000Z');
  // 19:00 in Madrid is 13:00 in New York and 20:00 in Moscow on the same instant.
  assert.match(zonedLabel(start, 'en', 'Europe/Madrid'), /^Friday, June 14, 2030 at 7:00.PM$/);
  assert.match(zonedLabel(start, 'en', 'America/New_York'), /^Friday, June 14, 2030 at 1:00.PM$/);
  assert.match(zonedLabel(start, 'ru', 'Europe/Moscow'), /14 июня 2030.*20:00/);
  // Late evening in Madrid is already the next day in Tokyo.
  assert.match(zonedLabel(new Date('2030-06-14T21:30:00.000Z'), 'en', 'Asia/Tokyo'), /^Saturday, June 15, 2030 at 6:30.AM$/);
  assert.equal(sameWallClock(start, 'Europe/Madrid', 'Europe/Paris'), true, 'same clock: nothing extra is shown');
  assert.equal(sameWallClock(start, 'Europe/Madrid', 'America/New_York'), false);
  assert.equal(sameWallClock(start, 'Europe/Madrid', 'Not/AZone'), true, 'an unknown browser zone shows nothing rather than failing');
  assert.equal(offsetIso(start, 'Europe/Madrid'), '2030-06-14T19:00:00+02:00');
  assert.equal(offsetIso(new Date('2030-12-14T18:00:00.000Z'), 'Europe/Madrid'), '2030-12-14T19:00:00+01:00');
  const event = {title: 'Swing </script><script>alert(1)</script>', description: 'Party', status: 'PUBLISHED', timezone: 'Europe/Madrid', priceText: null, lat: 40.41, lng: -3.71,
    city: {name: 'Madrid', countryCode: 'ES'}, venue: {name: 'Test Hall', address: '1 Test Street', lat: 40.41, lng: -3.71, hiddenAt: null}};
  const cast = {organizers: [{name: 'Owner', handle: 'owner', type: 'ORGANIZER'}], artists: [{name: 'DJ', handle: 'dj', type: 'ARTIST'}]};
  const links = {origin: 'https://dance.example', url: 'https://dance.example/en/events/x'};
  const ld = eventJsonLd(event, {startsAt: start, endsAt: new Date('2030-06-14T20:00:00.000Z'), cancelled: false}, cast, links);
  assert.equal(ld['@type'], 'Event');
  assert.deepEqual([ld.startDate, ld.endDate], ['2030-06-14T19:00:00+02:00', '2030-06-14T22:00:00+02:00']);
  assert.equal(ld.eventStatus, 'https://schema.org/EventScheduled');
  assert.equal(ld.eventAttendanceMode, 'https://schema.org/OfflineEventAttendanceMode');
  assert.deepEqual(ld.location, {'@type': 'Place', name: 'Test Hall', address: {'@type': 'PostalAddress', streetAddress: '1 Test Street', addressLocality: 'Madrid', addressCountry: 'ES'},
    geo: {'@type': 'GeoCoordinates', latitude: 40.41, longitude: -3.71}});
  assert.deepEqual(ld.organizer, [{'@type': 'Organization', name: 'Owner', url: 'https://dance.example/@owner'}]);
  assert.deepEqual(ld.performer, [{'@type': 'Person', name: 'DJ', url: 'https://dance.example/@dj'}]);
  assert.equal(eventJsonLd(event, {startsAt: start, endsAt: null, cancelled: true}, cast, links).eventStatus, 'https://schema.org/EventCancelled');
  assert.equal(eventJsonLd({...event, status: 'CANCELLED'}, {startsAt: start, endsAt: null, cancelled: false}, cast, links).eventStatus, 'https://schema.org/EventCancelled');
  // A city-level event (or a hidden venue) publishes no precise point.
  const cityLevel = eventJsonLd({...event, venue: {...event.venue, hiddenAt: new Date()}}, {startsAt: start, endsAt: null, cancelled: false}, cast, links);
  assert.deepEqual(cityLevel.location, {'@type': 'Place', name: 'Madrid', address: {'@type': 'PostalAddress', addressLocality: 'Madrid', addressCountry: 'ES'}});
  const html = safeJson(ld);
  assert.equal(html.includes('<'), false);
  assert.deepEqual(JSON.parse(html), JSON.parse(JSON.stringify(ld)));
  assert.equal(safeJson(String.fromCharCode(0x2028)), '"\\u2028"');
});
