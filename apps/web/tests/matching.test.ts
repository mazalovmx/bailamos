import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import {db} from '@dance/db';
import {ApiError} from '../src/lib/api';
import {haversine} from '../src/lib/geo/coarsen';
import {BANDS, distanceBand, freshness, levelGap, rank, roleFit, rolesCompatible, score} from '../src/lib/matching/score';
import {candidateQuery, excerpt, findCandidates, loadSearcher} from '../src/lib/matching/search';
import {blockProfile, dailyInterestLimit, expressInterest, interestInput, locationInput, myInterests, setLocation, touchActivity, withdrawInterest} from '../src/lib/matching/interest';
const tag = 'mt' + randomUUID().slice(0, 8);
after(async () => { await db.$disconnect(); });
const code = async (run: () => Promise<unknown>) => {
  try {await run();} catch (error) {if (error instanceof ApiError) return error.code; throw error;}
  return null;
};

test('role compatibility matrix', () => {
  const expected: Record<string, boolean> = {
    'LEADER/FOLLOWER': true, 'FOLLOWER/LEADER': true, 'LEADER/LEADER': false, 'FOLLOWER/FOLLOWER': false,
    'LEADER/BOTH': true, 'FOLLOWER/BOTH': true, 'BOTH/LEADER': true, 'BOTH/FOLLOWER': true, 'BOTH/BOTH': true
  };
  for (const [pair, ok] of Object.entries(expected)) {
    const [mine, theirs] = pair.split('/');
    assert.equal(rolesCompatible(mine, theirs), ok, pair);
    assert.equal(roleFit(mine, theirs) > 0, ok, pair);
  }
  assert.ok(roleFit('LEADER', 'FOLLOWER') > roleFit('LEADER', 'BOTH'), 'an exact complementary pair beats BOTH');
  assert.equal(roleFit('LEADER', 'BOTH'), roleFit('BOTH', 'BOTH'));
});
test('distance is only ever a band', () => {
  assert.deepEqual([0, 4999, 5000, 9999, 10000, 24999, 25000, 49999, 50000, 99999, 100000, 5e6].map(distanceBand),
    ['LT5', 'LT5', '5_10', '5_10', '10_25', '10_25', '25_50', '25_50', '50_100', '50_100', 'GT100', 'GT100']);
  for (const value of [null, undefined, Number.NaN, -1]) assert.equal(distanceBand(value), null);
  assert.equal(new Set(BANDS).size, 6);
});
test('scoring: level closeness, role fit, distance band, freshness and shared styles; stable order', () => {
  const now = new Date('2026-10-01T12:00:00Z'), ago = (days: number) => new Date(now.getTime() - days * 86400000);
  const ideal = {levelGap: 0, roleFit: 1, band: 'LT5' as const, lastActiveAt: now, sharedStyles: 3};
  assert.equal(score(ideal, now), 100);
  assert.equal(score({levelGap: 9, roleFit: 0, band: null, lastActiveAt: null, sharedStyles: 0}, now), 0);
  const worse = [{levelGap: 1}, {levelGap: 2}, {roleFit: 0.7}, {band: '5_10' as const}, {band: 'GT100' as const}, {band: null}, {lastActiveAt: ago(7)}, {lastActiveAt: null}, {sharedStyles: 0}];
  for (const change of worse) assert.ok(score({...ideal, ...change}, now) < 100, JSON.stringify(change));
  assert.ok(score({...ideal, levelGap: 1}, now) > score({...ideal, levelGap: 2}, now));
  assert.ok(score({...ideal, levelGap: 2}, now) > score({...ideal, levelGap: 3}, now));
  assert.ok(score({...ideal, band: '10_25'}, now) > score({...ideal, band: '25_50'}, now));
  assert.equal(levelGap('NEWCOMER', 'PRO'), 4);
  assert.equal(levelGap('ADVANCED', 'INTERMEDIATE'), 1);
  // Freshness halves every 14 days and never rewards a timestamp in the future.
  assert.equal(freshness(now, now), 1);
  assert.ok(Math.abs(freshness(ago(14), now) - 0.5) < 1e-9);
  assert.ok(freshness(ago(1), now) > freshness(ago(30), now) && freshness(ago(365), now) < 0.001);
  assert.equal(freshness(new Date(now.getTime() + 86400000), now), 1);
  assert.equal(freshness(null, now), 0);
  // Deterministic: same inputs, same score; ties are broken by id whatever the input order.
  assert.equal(score({...ideal, lastActiveAt: ago(3)}, now), score({...ideal, lastActiveAt: ago(3)}, now));
  const items = [{id: 'c', score: 50}, {id: 'a', score: 50}, {id: 'z', score: 90}, {id: 'b', score: 50}];
  assert.deepEqual(rank(items).map(item => item.id), ['z', 'a', 'b', 'c']);
  assert.deepEqual(rank([...items].reverse()).map(item => item.id), ['z', 'a', 'b', 'c']);
});
test('search and mutation input is validated strictly', () => {
  assert.deepEqual(candidateQuery.parse({}), {subStyles: false, widen: false, offset: 0, limit: 20});
  assert.equal(candidateQuery.parse({radiusKm: '25', widen: '1', subStyles: '1', style: 'lindy-hop', offset: '40', limit: '50'}).radiusKm, 25);
  const bad: Record<string, string>[] = [{radiusKm: '7'}, {radiusKm: '1000'}, {radiusKm: '25', cityId: 'madrid'}, {lat: '40.4', lng: '-3.7'}, {limit: '51'}, {limit: '0'},
    {offset: '-1'}, {offset: '1e3'}, {widen: 'true'}, {style: "x'; DROP TABLE \"Profile\"; --"}, {cityId: ''}, {profileId: 'abc'}];
  for (const input of bad) assert.equal(candidateQuery.safeParse(input).success, false, JSON.stringify(input));
  assert.equal(interestInput.safeParse({profileId: 'abc', extra: 1}).success, false);
  assert.equal(interestInput.safeParse({profileId: ''}).success, false);
  assert.equal(locationInput.safeParse(null).success, true);
  for (const input of [{lat: 91, lng: 0}, {lat: 40}, {lat: '40', lng: '-3'}, {lat: 40, lng: -3, district: 'x'.repeat(81)}, {lat: 40, lng: -3, geo: 'x'}, undefined])
    assert.equal(locationInput.safeParse(input).success, false, JSON.stringify(input));
  assert.equal(excerpt('  a\n\n b  '), 'a b');
  assert.equal(excerpt('x'.repeat(500))!.length, 160);
  assert.equal(excerpt('   '), null);
  assert.equal(dailyInterestLimit(), Number(process.env.MATCHING_DAILY_INTEREST_LIMIT) || 30);
});

// A remote patch of the South Pacific keeps the radius checks apart from seeded and real data.
const base = {lat: -47.5, lng: -131.25}, north = (km: number) => ({lat: base.lat + km / 111.2, lng: base.lng});
type Skill = {styleId: string; role: 'LEADER' | 'FOLLOWER' | 'BOTH'; level: 'NEWCOMER' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'PRO'; lookingFor?: boolean};
const style = tag + '-style', subStyle = tag + '-sub', otherStyle = tag + '-other', home = tag + '-home', away = tag + '-away';
async function person(key: string, skills: Skill[], data: {cityId?: string; lat?: number; lng?: number; hiddenAt?: Date; lastActiveAt?: Date | null; district?: string; bio?: string} = {},
  account: {banned?: boolean; stub?: boolean; verified?: boolean} = {}) {
  const userId = tag + '-u-' + key, profileId = tag + '-p-' + key;
  if (!account.stub) await db.user.create({data: {id: userId, name: 'Test ' + key, email: userId + '@example.test', emailVerified: account.verified !== false,
    bannedAt: account.banned ? new Date() : null}});
  await db.profile.create({data: {id: profileId, userId: account.stub ? null : userId, type: 'DANCER', handle: tag + '-' + key, name: 'Test ' + key,
    cityId: home, lastActiveAt: new Date(), ...data, skills: {create: skills}}});
  return {id: userId, emailVerified: account.verified !== false, profile: {id: profileId}};
}
const searcher = async (user: {id: string; emailVerified: boolean; profile: {id: string}}) => {
  const result = await loadSearcher(user);
  assert.ok('searcher' in result, 'reason' in result ? result.reason : '');
  return result.searcher;
};
const follower = (level: Skill['level'] = 'INTERMEDIATE', extra: Partial<Skill> = {}): Skill[] => [{styleId: style, role: 'FOLLOWER', level, lookingFor: true, ...extra}];
const keys = (rows: {profileId: string}[]) => rows.map(row => row.profileId.replace(tag + '-p-', ''));
const query = (input: Record<string, string> = {}) => candidateQuery.parse(input);
async function cleanup() {
  await db.user.deleteMany({where: {id: {startsWith: tag}}});
  await db.profile.deleteMany({where: {id: {startsWith: tag}}});
  await db.danceStyle.deleteMany({where: {id: {in: [subStyle]}}});
  await db.danceStyle.deleteMany({where: {id: {in: [style, otherStyle]}}});
  await db.city.deleteMany({where: {id: {in: [home, away]}}});
}
test('partner search: consent, reciprocity, filters, privacy, interest and blocks', {timeout: 120000}, async () => {
  const limit = process.env.MATCHING_DAILY_INTEREST_LIMIT;
  try {
    await db.city.createMany({data: [{id: home, slug: home, name: 'Matchtown', countryCode: 'ZZ', timezone: 'UTC', ...base},
      {id: away, slug: away, name: 'Farville', countryCode: 'ZZ', timezone: 'UTC', ...north(40)}]});
    await db.danceStyle.createMany({data: [{id: style, slug: style, name: 'Test style ' + tag}, {id: otherStyle, slug: otherStyle, name: 'Test other ' + tag}]});
    await db.danceStyle.create({data: {id: subStyle, slug: subStyle, name: 'Test sub ' + tag, parentId: style}});
    const exact = {lat: -47.503217, lng: -131.254321};
    const meUser = await person('me', [{styleId: style, role: 'LEADER', level: 'INTERMEDIATE', lookingFor: true}, {styleId: otherStyle, role: 'LEADER', level: 'BEGINNER'}], base);
    const old = new Date(Date.now() - 60 * 86400000);
    const followerUser = await person('follower', [...follower(), {styleId: otherStyle, role: 'FOLLOWER', level: 'PRO'}],
      {...north(3), district: ' Old Port ', bio: 'Lindy hopper. ' + 'word '.repeat(80)});
    await person('both', follower('INTERMEDIATE', {role: 'BOTH'}), base);
    await person('adv', follower('ADVANCED'), base);
    await person('stale', follower(), {...base, lastActiveAt: old});
    await person('pro', follower('PRO'), base);
    await person('leader', follower('INTERMEDIATE', {role: 'LEADER'}), base);
    await person('notlooking', follower('INTERMEDIATE', {lookingFor: false}), base);
    await person('defaultoff', [{styleId: style, role: 'FOLLOWER', level: 'INTERMEDIATE'}], base);
    await person('otheronly', [{styleId: style, role: 'FOLLOWER', level: 'INTERMEDIATE'}, {styleId: otherStyle, role: 'FOLLOWER', level: 'BEGINNER', lookingFor: true}], base);
    await person('sub', follower('INTERMEDIATE', {styleId: subStyle}), base);
    await person('hidden', follower(), {...base, hiddenAt: new Date()});
    await person('banned', follower(), base, {banned: true});
    await person('stub', follower(), base, {stub: true});
    const blockedByMe = await person('blockedbyme', follower(), base), blockedMe = await person('blockedme', follower(), base);
    await person('far', follower(), {...north(40), cityId: away});
    await person('nocoords', follower(), {cityId: away});
    await person('toofar', follower(), {...north(70), cityId: away});
    await db.block.createMany({data: [{blockerProfileId: meUser.profile.id, blockedProfileId: blockedByMe.profile.id},
      {blockerProfileId: blockedMe.profile.id, blockedProfileId: meUser.profile.id}]});
    const me = await searcher(meUser);

    // Reciprocity and access: no session, no verification, no profile, no own lookingFor skill -> no search.
    const reason = async (user: Parameters<typeof loadSearcher>[0]) => {const result = await loadSearcher(user); return 'reason' in result ? result.reason : null;};
    assert.equal(await reason(null), 'UNAUTHORIZED');
    assert.equal(await reason({...meUser, emailVerified: false}), 'VERIFY_EMAIL');
    assert.equal(await reason({...meUser, bannedAt: new Date()}), 'BANNED');
    assert.equal(await reason({...meUser, profile: null}), 'PROFILE_REQUIRED');
    assert.equal(await reason({id: tag + '-u-follower', emailVerified: true, profile: meUser.profile}), 'PROFILE_REQUIRED', 'somebody else\'s profile id');
    assert.equal(await reason(await person('quiet', [{styleId: style, role: 'FOLLOWER', level: 'INTERMEDIATE'}], base)), 'LOOKING_FOR_REQUIRED');
    assert.equal(await reason({id: tag + '-u-hidden', emailVerified: true, profile: {id: tag + '-p-hidden'}}), 'PROFILE_HIDDEN');
    assert.equal(await reason({id: tag + '-u-banned', emailVerified: true, profile: {id: tag + '-p-banned'}}), 'BANNED');
    assert.deepEqual(me.skills.map(skill => skill.styleId), [style], 'only lookingFor skills define the search');

    // Default search: own city, own lookingFor styles, compatible role, level within one step, best score first.
    const first = await findCandidates(me, query());
    assert.deepEqual(keys(first.candidates), ['follower', 'both', 'adv', 'stale']);
    assert.equal(first.total, 4);
    assert.equal(first.nextOffset, null);
    const never = ['notlooking', 'defaultoff', 'otheronly', 'quiet', 'hidden', 'banned', 'stub', 'blockedbyme', 'blockedme', 'leader', 'me'];
    const wide = await findCandidates(me, query({widen: '1', subStyles: '1', radiusKm: '100', limit: '50'}));
    for (const key of never) assert.equal(keys(wide.candidates).includes(key), false, key + ' must never be returned');
    assert.deepEqual(keys(wide.candidates).sort(), ['adv', 'both', 'far', 'follower', 'nocoords', 'pro', 'stale', 'sub', 'toofar']);
    // Level: PRO is two steps from INTERMEDIATE and needs the widen toggle.
    assert.deepEqual(keys((await findCandidates(me, query({widen: '1'}))).candidates), ['follower', 'both', 'adv', 'stale', 'pro']);
    // Sub-styles are opt-in; a skill in another style never leaks into the card.
    assert.ok(keys((await findCandidates(me, query({subStyles: '1'}))).candidates).includes('sub'));
    assert.deepEqual(first.candidates[0].skills.map(skill => skill.styleId), [style]);
    assert.equal(await code(() => findCandidates(me, query({style: otherStyle}))), 'STYLE_NOT_ALLOWED', 'cannot search in a style without own lookingFor');
    assert.deepEqual(keys((await findCandidates(me, query({style}))).candidates), keys(first.candidates));
    // Radius through PostGIS, with the city centre standing in for a profile without coordinates.
    assert.deepEqual(keys((await findCandidates(me, query({radiusKm: '10'}))).candidates), ['follower', 'both', 'adv', 'stale']);
    assert.deepEqual(keys((await findCandidates(me, query({radiusKm: '25'}))).candidates), ['follower', 'both', 'adv', 'stale']);
    assert.deepEqual(keys((await findCandidates(me, query({radiusKm: '50'}))).candidates).sort(), ['adv', 'both', 'far', 'follower', 'nocoords', 'stale']);
    assert.deepEqual(keys((await findCandidates(me, query({cityId: away}))).candidates).sort(), ['far', 'nocoords', 'toofar']);
    const byKey = Object.fromEntries(wide.candidates.map(candidate => [candidate.profileId.replace(tag + '-p-', ''), candidate]));
    assert.equal(byKey.follower.distanceBand, 'LT5');
    assert.equal(byKey.far.distanceBand, '25_50');
    assert.equal(byKey.toofar.distanceBand, '50_100');
    assert.equal(byKey.nocoords.distanceBand, null, 'no made-up distance for a city-centre fallback');
    // Pagination is stable and complete.
    const pages = [await findCandidates(me, query({limit: '3'})), await findCandidates(me, query({limit: '3', offset: '3'}))];
    assert.deepEqual([...keys(pages[0].candidates), ...keys(pages[1].candidates)], keys(first.candidates));
    assert.deepEqual([pages[0].nextOffset, pages[1].nextOffset], [3, null]);

    // Role matrix against the database.
    const mySkill = {profileId_styleId_role: {profileId: meUser.profile.id, styleId: style, role: 'LEADER' as const}};
    await db.danceSkill.update({where: mySkill, data: {role: 'FOLLOWER'}});
    assert.deepEqual(keys((await findCandidates(await searcher(meUser), query())).candidates), ['leader', 'both']);
    await db.danceSkill.update({where: {profileId_styleId_role: {...mySkill.profileId_styleId_role, role: 'FOLLOWER'}}, data: {role: 'BOTH'}});
    assert.deepEqual(keys((await findCandidates(await searcher(meUser), query())).candidates).sort(), ['adv', 'both', 'follower', 'leader', 'stale']);
    await db.danceSkill.update({where: {profileId_styleId_role: {...mySkill.profileId_styleId_role, role: 'BOTH'}}, data: {role: 'LEADER'}});

    // Privacy: the serialized payload has a fixed shape and carries no coordinates, distances, activity times or scores.
    const json = JSON.stringify(wide);
    for (const candidate of wide.candidates) assert.deepEqual(Object.keys(candidate).sort(),
      ['avatarKey', 'bio', 'city', 'distanceBand', 'district', 'handle', 'interested', 'name', 'profileId', 'skills'].sort());
    for (const word of ['"lat"', '"lng"', '"geo"', 'distanceM', 'lastActiveAt', 'score', 'userId', 'email', 'shared', '-47.', '-131.', '47.4', '131.2'])
      assert.equal(json.includes(word), false, 'payload must not contain ' + word);
    assert.equal(/-?\d+\.\d{3,}/.test(json), false, 'no decimal numbers that could be coordinates or metres');
    assert.equal(byKey.follower.district, 'Old Port');
    assert.equal(byKey.follower.city, 'Matchtown');
    assert.ok(byKey.follower.bio!.length <= 160 && byKey.follower.bio!.endsWith('…'));

    // Location capture stores the coarsened grid cell only.
    assert.deepEqual(await setLocation(meUser.profile.id, {...exact, district: 'Harbour'}), {located: true});
    const stored = await db.profile.findUniqueOrThrow({where: {id: meUser.profile.id}, select: {lat: true, lng: true, district: true}});
    assert.notDeepEqual({lat: stored.lat, lng: stored.lng}, exact);
    assert.ok(haversine(exact, {lat: stored.lat!, lng: stored.lng!}) < 1300);
    assert.equal(stored.district, 'Harbour');
    const [{inside}] = await db.$queryRaw<{inside: boolean}[]>`SELECT ST_DWithin(geo, ST_SetSRID(ST_MakePoint(${stored.lng}::float8, ${stored.lat}::float8), 4326)::geography, 1) AS inside FROM "Profile" WHERE id = ${meUser.profile.id}`;
    assert.equal(inside, true, 'geo follows the coarsened point');
    assert.deepEqual(await setLocation(meUser.profile.id, null), {located: false});
    const cleared = await db.$queryRaw<{empty: boolean}[]>`SELECT (geo IS NULL AND lat IS NULL AND lng IS NULL) AS empty FROM "Profile" WHERE id = ${meUser.profile.id}`;
    assert.equal(cleared[0].empty, true);
    // Without own coordinates the radius is measured from the city centre and no band is shown.
    const fallback = await findCandidates(await searcher(meUser), query({radiusKm: '25'}));
    assert.deepEqual(keys(fallback.candidates), ['follower', 'both', 'adv', 'stale']);
    assert.ok(fallback.candidates.every(candidate => candidate.distanceBand === null));
    await db.profile.update({where: {id: meUser.profile.id}, data: base});

    // Activity is written at most once per hour.
    const t0 = new Date(Date.now() + 5 * 3600000);
    assert.equal(await touchActivity(meUser.profile.id, t0), true);
    assert.equal(await touchActivity(meUser.profile.id, new Date(t0.getTime() + 59 * 60000)), false);
    assert.equal(await touchActivity(meUser.profile.id, new Date(t0.getTime() + 61 * 60000)), true);

    // Two-sided interest: silent while one-sided, one notification each when mutual, never repeated.
    const them = await searcher(followerUser), ids = [meUser.id, followerUser.id];
    const notes = () => db.notification.findMany({where: {userId: {in: ids}, type: 'PARTNER_MATCH'}, orderBy: {userId: 'asc'}});
    assert.deepEqual(await expressInterest(me, {profileId: them.profileId, styleId: style}), {interested: true, matched: false});
    assert.equal((await notes()).length, 0, 'one-sided interest is not announced');
    assert.equal(await db.notification.count({where: {userId: followerUser.id}}), 0);
    assert.deepEqual((await myInterests(them.profileId)), {matches: [], sent: []}, 'the recipient cannot see who is interested');
    assert.deepEqual(keys((await myInterests(me.profileId)).sent), ['follower']);
    assert.equal((await findCandidates(me, query())).candidates[0].interested, true);
    assert.equal(JSON.stringify(await findCandidates(them, query())).includes('"interested":true'), false, 'the other side sees no hint');
    assert.deepEqual(await expressInterest(me, {profileId: them.profileId}), {interested: true, matched: false}, 'idempotent');
    assert.deepEqual(await expressInterest(them, {profileId: me.profileId}), {interested: true, matched: true});
    const told = await notes();
    assert.equal(told.length, 2);
    assert.deepEqual(told.map(note => note.userId).sort(), [...ids].sort());
    const mine = told.find(note => note.userId === meUser.id)!;
    assert.deepEqual(mine.data, {profileId: them.profileId, handle: them.handle, name: them.name, styleId: style});
    assert.equal(mine.url, '/partners/matches');
    assert.equal(JSON.stringify(told).includes(exact.lat.toString()), false);
    await expressInterest(them, {profileId: me.profileId});
    await expressInterest(me, {profileId: them.profileId});
    await withdrawInterest(me.profileId, them.profileId);
    assert.deepEqual(keys((await myInterests(them.profileId)).sent), ['me']);
    assert.deepEqual(await expressInterest(me, {profileId: them.profileId}), {interested: true, matched: true});
    assert.equal((await notes()).length, 2, 'the match notification fires exactly once per person');
    assert.deepEqual(keys((await myInterests(me.profileId)).matches), ['follower']);
    assert.deepEqual(keys((await myInterests(them.profileId)).matches), ['me']);
    assert.deepEqual((await myInterests(me.profileId)).sent, []);
    // Simultaneous mutual clicks still give one notification each.
    const bothUser = {id: tag + '-u-both', emailVerified: true, profile: {id: tag + '-p-both'}}, both = await searcher(bothUser);
    await Promise.all([expressInterest(me, {profileId: both.profileId}), expressInterest(both, {profileId: me.profileId})]);
    assert.equal(await db.notification.count({where: {userId: {in: [meUser.id, bothUser.id]}, type: 'PARTNER_MATCH', data: {path: ['profileId'], equals: both.profileId}}}), 1);
    assert.equal(await db.notification.count({where: {userId: bothUser.id, type: 'PARTNER_MATCH'}}), 1);
    // Interest is possible only towards people partner search would show.
    for (const key of ['notlooking', 'hidden', 'banned', 'stub', 'blockedbyme', 'blockedme', 'missing'])
      assert.equal(await code(() => expressInterest(me, {profileId: tag + '-p-' + key})), 'NOT_FOUND', key);
    assert.equal(await code(() => expressInterest(me, {profileId: me.profileId})), 'INVALID_INPUT');
    assert.equal(await code(() => expressInterest(me, {profileId: tag + '-p-adv', styleId: otherStyle})), 'INVALID_INPUT');
    // Daily cap on new interests; repeating an existing one is still fine.
    process.env.MATCHING_DAILY_INTEREST_LIMIT = '2';
    assert.equal(await code(() => expressInterest(me, {profileId: tag + '-p-adv'})), 'DAILY_LIMIT');
    assert.deepEqual(await expressInterest(me, {profileId: them.profileId}), {interested: true, matched: true});
    process.env.MATCHING_DAILY_INTEREST_LIMIT = '3';
    assert.deepEqual(await expressInterest(me, {profileId: tag + '-p-adv'}), {interested: true, matched: false});

    // Blocking from a card: removes interest in both directions and hides both from each other.
    assert.deepEqual(await blockProfile(me.profileId, them.profileId), {blocked: true});
    assert.deepEqual(await blockProfile(me.profileId, them.profileId), {blocked: true}, 'idempotent');
    assert.equal(await db.partnerInterest.count({where: {OR: [{fromProfileId: me.profileId, toProfileId: them.profileId}, {fromProfileId: them.profileId, toProfileId: me.profileId}]}}), 0);
    assert.equal(keys((await findCandidates(me, query())).candidates).includes('follower'), false);
    assert.equal(keys((await findCandidates(them, query())).candidates).includes('me'), false);
    assert.equal(await code(() => expressInterest(them, {profileId: me.profileId})), 'NOT_FOUND', 'the blocked person cannot tell a block from a missing profile');
    assert.equal(keys((await myInterests(them.profileId)).matches).length, 0);
    assert.equal(await code(() => blockProfile(me.profileId, me.profileId)), 'INVALID_INPUT');
    assert.equal(await code(() => blockProfile(me.profileId, tag + '-p-missing')), 'NOT_FOUND');
    // Switching lookingFor off removes the profile from search at once.
    await db.danceSkill.updateMany({where: {profileId: tag + '-p-adv'}, data: {lookingFor: false}});
    assert.equal(keys((await findCandidates(me, query())).candidates).includes('adv'), false);
  } finally {
    if (limit === undefined) delete process.env.MATCHING_DAILY_INTEREST_LIMIT; else process.env.MATCHING_DAILY_INTEREST_LIMIT = limit;
    await cleanup();
  }
});
test('partner pages are private: noindex and absent from the sitemap', async () => {
  const {readFileSync, existsSync} = await import('node:fs');
  for (const page of ['page.tsx', 'matches/page.tsx', 'sent/page.tsx']) {
    const source = readFileSync(new URL('../src/app/[locale]/partners/' + page, import.meta.url), 'utf8');
    assert.ok(source.includes('robots: {index: false, follow: false}'), page);
  }
  const sitemap = new URL('../src/app/sitemap.ts', import.meta.url);
  if (existsSync(sitemap)) assert.equal(readFileSync(sitemap, 'utf8').includes('partners'), false);
});
