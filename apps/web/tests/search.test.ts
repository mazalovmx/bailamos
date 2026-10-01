import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db, Prisma} from '@dance/db';
import {accentVariants, cleanQuery, fold, highlight, isAdvanced, prefixTsQuery, queryWords, searchable, snippet} from '../src/lib/search/text';
import {eventsSql, parseSearch, postsSql, profilesSql, search, searchInput, similaritySql, type SearchResult} from '../src/lib/search/search';
import {ApiError} from '../src/lib/api';
import {resetMemoryRateLimits} from '../src/lib/rate-limit';
import {closeRedis} from '../src/lib/redis';
import * as route from '../src/app/api/search/route';
config({path: '../../.env', quiet: true});
const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
// Every fixture is found by a random ten-letter word of its own, so runs never see each other's rows (the database is shared)
// and two fixtures never look alike to the trigram matcher. `tag` only keeps slugs, handles and emails unique.
const tag = randomUUID().slice(0, 8);
const word = (alphabet = 'bcdfghjklmnpqrst') => [...randomUUID().replace(/-/g, '')].slice(0, 10).map(char => alphabet[parseInt(char, 16)]).join('');
const cyrillic = () => word('бвгджзклмнпрстфх');
const W = {fest: word(), fiesta: word(), party: cyrillic(), ova: word(), ez: word(), swing: word(), school: cyrillic(), blog: word(), rhythm: word(),
  ballroom: word(), calle: word(), markup: word(), none: word()};
// Two neighbouring letters swapped.
const typo = (value: string) => value.slice(0, 4) + value[5] + value[4] + value.slice(6);
const day = 86400000, now = new Date();
const ids = {users: [] as string[], events: [] as string[], venues: [] as string[]};
const text = (segments: {text: string}[] | null) => (segments || []).map(segment => segment.text).join('');
const hits = (segments: {text: string; hit?: true}[] | null) => (segments || []).filter(segment => segment.hit).map(segment => segment.text);
const run = (q: string, extra: Partial<Parameters<typeof search>[0]> = {}, viewer?: string) => search(searchInput.parse({q, ...extra}), viewer);
const titles = (result: SearchResult, type: keyof SearchResult['groups']) => result.groups[type].map(hit => text(hit.title));
let profiles: Record<'anna' | 'jose' | 'hidden' | 'banned' | 'blocker' | 'school' | 'hiddenAuthor', {id: string; handle: string}>;
before(async () => {
  const people = [['anna', 'Anna ' + W.ova, 'DANCER', 'Lindy hop and balboa in Málaga'], ['jose', 'José ' + W.ez, 'ARTIST', 'Teaches ' + W.swing],
    ['hidden', 'Hidden ' + W.ova, 'DANCER', null], ['banned', 'Banned ' + W.ova, 'DANCER', null], ['blocker', 'Blocker ' + W.ova, 'DANCER', null],
    ['school', 'Escuela ' + W.ova, 'SCHOOL', 'Школа танцев ' + W.school], ['hiddenAuthor', 'Ghost ' + W.none + 'x', 'DANCER', null]] as const;
  const users = people.map(([role]) => ({id: 'srch-' + role + '-' + tag, name: 'Search ' + role, email: 'srch-' + role + '-' + tag + '@example.test', emailVerified: true,
    bannedAt: role === 'banned' ? now : null}));
  ids.users = users.map(user => user.id);
  await db.user.createMany({data: users});
  const rows = await Promise.all(people.map(([role, name, type, bio], index) => db.profile.create({data: {userId: users[index].id, type, handle: 'srch-' + role + '-' + tag, name, bio,
    cityId: role === 'jose' ? 'madrid' : 'moscow', lat: 55.75, lng: 37.61, hiddenAt: role === 'hidden' || role === 'hiddenAuthor' ? now : null}})));
  profiles = {anna: rows[0], jose: rows[1], hidden: rows[2], banned: rows[3], blocker: rows[4], school: rows[5], hiddenAuthor: rows[6]};
  await db.block.create({data: {blockerProfileId: profiles.blocker.id, blockedProfileId: profiles.anna.id}});
  const event = (name: string, title: string, data: {description?: string; startsAt?: Date; status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'; hiddenAt?: Date; cityId?: string} = {}) =>
    db.event.create({data: {slug: 'srch-' + name + '-' + tag, title, description: data.description, cityId: data.cityId || 'madrid', timezone: 'Europe/Madrid',
      startsAt: data.startsAt || new Date(+now + 7 * day), status: data.status || 'PUBLISHED', hiddenAt: data.hiddenAt,
      occurrences: {create: {startsAt: data.startsAt || new Date(+now + 7 * day)}}}});
  const events = await Promise.all([
    event('exact', W.fest + ' Lindy Hop Night', {description: 'Live band and social dancing until late.'}),
    event('past', W.fest + ' Lindy Hop Night', {startsAt: new Date(+now - 30 * day)}),
    event('body', 'Friday social', {description: 'A relaxed evening. We end with a ' + W.fest + ' jam circle for everyone who stays.', cityId: 'moscow'}),
    event('accent', 'Salón ' + W.fiesta + ' en Málaga'), event('cyrillic', 'Ёлка ' + W.party + ' в Москве', {cityId: 'moscow'}),
    event('draft', W.fest + ' draft', {status: 'DRAFT'}), event('hidden', W.fest + ' hidden', {hiddenAt: now}), event('cancelled', W.fest + ' cancelled', {status: 'CANCELLED'}),
    event('html', W.markup + ' <script>alert(1)</script> & "quotes"', {description: '<img src=x onerror=alert(1)> ' + W.markup})]);
  ids.events = events.map(row => row.id);
  const post = (author: string, name: string, title: string, data: {excerpt?: string; publishedAt?: Date | null; hiddenAt?: Date} = {}) => db.post.create({data: {
    profileId: author, slug: 'srch-' + name + '-' + tag, title, excerpt: data.excerpt, content: {}, publishedAt: data.publishedAt === undefined ? now : data.publishedAt, hiddenAt: data.hiddenAt}});
  await Promise.all([post(profiles.jose.id, 'public', W.blog + ' about musicality', {excerpt: 'How to hear the ' + W.rhythm + ' in swing music.'}),
    post(profiles.jose.id, 'draft', W.blog + ' draft', {publishedAt: null}), post(profiles.jose.id, 'hidden', W.blog + ' hidden', {hiddenAt: now}),
    post(profiles.hiddenAuthor.id, 'ghost', W.blog + ' by a hidden author')]);
  const venue = (name: string, address: string, hiddenAt?: Date) => db.venue.create({data: {name, address, cityId: 'madrid', lat: 40.4, lng: -3.7, hiddenAt}});
  ids.venues = (await Promise.all([venue('Sala ' + W.ballroom, 'Calle de la ' + W.calle + ' 12, Madrid'), venue('Hidden ' + W.ballroom, 'Nowhere 1', now)])).map(row => row.id);
});
after(async () => {
  await db.event.deleteMany({where: {id: {in: ids.events}}});
  await db.venue.deleteMany({where: {id: {in: ids.venues}}});
  await db.user.deleteMany({where: {id: {in: ids.users}}});
  await closeRedis();
  await db.$disconnect();
});
test('query helpers: cleaning, folding, word extraction, accent variants and tsquery operands', () => {
  assert.equal(cleanQuery('  lindy\u0000\t hop \n'), 'lindy hop');
  assert.equal(cleanQuery('x'.repeat(500)).length, 100);
  assert.deepEqual([fold('Málaga'), fold('SALÓN'), fold('Ёлка'), fold('Район'), fold('Köln')], ['malaga', 'salon', 'елка', 'район', 'koln']);
  assert.deepEqual(queryWords('Lindy-Hop, lindy & "hop"! 2026'), ['lindy', 'hop', '2026']);
  assert.equal(queryWords('a b c d e f g h i j k').length, 8);
  assert.deepEqual([searchable(''), searchable('a'), searchable('!!'), searchable('a b'), searchable('ab'), searchable('я'), searchable('да')], [false, false, false, false, true, false, true]);
  assert.ok(['malaga', 'málaga', 'malága', 'malagá'].every(variant => accentVariants('malaga').includes(variant)));
  assert.ok(accentVariants('Málaga'.toLowerCase()).includes('malaga'), 'an accented query also finds unaccented text');
  assert.ok(accentVariants('елка').includes('ёлка') && accentVariants('nino').includes('niño'));
  assert.ok(accentVariants('a'.repeat(40)).length <= 48);
  assert.equal(prefixTsQuery('hop'), '(hop:* | hóp:* | hòp:* | hôp:* | hõp:* | höp:* | hőp:*)');
  assert.equal(prefixTsQuery('x 12'), '(12:*)');
  assert.equal(prefixTsQuery('Köln bal'), '(köln | koln | kóln | kòln | kôln | kõln | kőln | kołn | kolñ | kolń) & (bal:* | bál:* | bàl:* | bâl:* | bãl:* | bäl:* | bål:* | bał:*)');
  assert.equal(prefixTsQuery('!!! ((('), '');
  // Only letters, digits and the operators written by the builder itself can reach to_tsquery.
  assert.match(prefixTsQuery(`a'b) | !c:* & <-> \\ "d" ; DROP TABLE "Event"; --`), /^[\p{L}\p{N} ()|&:*]+$/u);
  assert.deepEqual([isAdvanced('"lindy hop"'), isAdvanced('swing -beginner'), isAdvanced('salsa OR bachata'), isAdvanced('rock-n-roll'), isAdvanced('lindy hop')], [true, true, true, false, false]);
});
test('highlighting returns plain-text segments around matched words and never markup', () => {
  assert.deepEqual(highlight('Lindy Hop Night', 'hop lin'), [{text: 'Lindy', hit: true}, {text: ' '}, {text: 'Hop', hit: true}, {text: ' Night'}]);
  assert.deepEqual(hits(highlight('Fiesta en Málaga y el salón', 'malaga SALON')), ['Málaga', 'salón']);
  assert.deepEqual(hits(highlight('Ёлка в Москве', 'елка моск')), ['Ёлка', 'Москве']);
  assert.deepEqual(highlight('Nothing here', 'zzz'), [{text: 'Nothing here'}]);
  const evil = '<script>alert(1)</script> swing <b>night</b>';
  assert.equal(text(highlight(evil, 'swing')), evil, 'the text is passed through unchanged, as text');
  assert.deepEqual(hits(highlight(evil, 'swing script')), ['script', 'script', 'swing']);
  const long = 'word '.repeat(80) + 'the needle is here ' + 'tail '.repeat(80), cut = snippet(long, 'needle')!;
  assert.ok(text(cut).length <= 190 && text(cut).startsWith('… ') && text(cut).endsWith(' …'));
  assert.deepEqual(hits(cut), ['needle']);
  assert.equal(text(snippet('Short text', 'zzz')), 'Short text');
  assert.equal(snippet('   ', 'x'), null);
  assert.equal(snippet(null, 'x'), null);
});
test('input validation: type, cursor and limit are checked; short queries and unknown cities are refused', async () => {
  assert.deepEqual(parseSearch(new URLSearchParams('q=lindy')), {q: 'lindy', type: 'all', locale: 'en'});
  assert.deepEqual(parseSearch(new URLSearchParams('q=lindy&type=people&city=madrid&cursor=20&limit=3&locale=ru')), {q: 'lindy', type: 'people', city: 'madrid', cursor: '20', limit: 3, locale: 'ru'});
  for (const bad of ['q=x&type=users', 'q=x&cursor=-1', 'q=x&cursor=1e3', 'q=x&cursor=99999', 'q=x&limit=0', 'q=x&limit=500', 'q=x&locale=de', 'q=' + 'x'.repeat(401)])
    assert.throws(() => parseSearch(new URLSearchParams(bad)), bad);
  const code = (error: unknown, expected: string) => error instanceof ApiError && error.code === expected && error.status === 400;
  for (const q of ['', ' ', 'a', '%', '!!!', 'a b']) await assert.rejects(run(q), (error: unknown) => code(error, 'QUERY_TOO_SHORT'), JSON.stringify(q));
  await assert.rejects(run(W.fest, {city: 'no-such-city'}), (error: unknown) => code(error, 'CITY_NOT_FOUND'));
});
test('events: only published and visible ones; upcoming before past; title matches before description matches; snippets', async () => {
  const result = await run(W.fest, {type: 'events'});
  assert.deepEqual(result.groups.events.map(hit => hit.path), ['exact', 'body', 'past'].map(name => '/events/srch-' + name + '-' + tag), 'draft, hidden and cancelled events are absent');
  assert.deepEqual(result.groups.events.map(hit => hit.upcoming), [true, true, false]);
  assert.equal(result.counts.events, 3);
  assert.deepEqual(hits(result.groups.events[0].title), [W.fest]);
  assert.deepEqual(hits(result.groups.events[1].snippet), [W.fest]);
  assert.equal(result.groups.events[0].city, 'Madrid');
  assert.deepEqual([result.groups.people, result.groups.posts, result.nextCursor], [[], [], null]);
  // Words may come in any order and the last one may be unfinished (search as you type).
  assert.deepEqual((await run('night lindy ' + W.fest.slice(0, 7), {type: 'events'})).groups.events.map(hit => hit.upcoming), [true, false]);
  // websearch syntax: a quoted phrase and an exclusion.
  assert.equal((await run('"' + W.fest + ' lindy"', {type: 'events'})).counts.events, 2);
  assert.equal((await run(W.fest + ' -lindy', {type: 'events'})).counts.events, 1);
});
test('typo tolerance: a misspelled title, name or venue still finds the row, below exact matches', async () => {
  const misspelled = await run(typo(W.fest) + ' lindy hpo', {type: 'events'});
  assert.deepEqual(titles(misspelled, 'events'), [W.fest + ' Lindy Hop Night', W.fest + ' Lindy Hop Night']);
  assert.deepEqual(titles(await run('Ana ' + W.ova, {type: 'people'}), 'people').slice(0, 1), ['Anna ' + W.ova]);
  assert.deepEqual(titles(await run('sala ' + typo(W.ballroom), {type: 'venues'}), 'venues'), ['Sala ' + W.ballroom]);
  assert.deepEqual(titles(await run(typo(W.blog) + ' musicality', {type: 'posts'}), 'posts'), [W.blog + ' about musicality'], 'posts fall back to a fuzzy title match');
  assert.equal((await run(W.none)).total, 0);
});
test('accent-insensitive in both directions, for Latin and Cyrillic text', async () => {
  const one = async (q: string) => (await run(q, {type: 'events'})).groups.events.map(hit => hit.path.split('-')[1]);
  assert.deepEqual(await one('salon ' + W.fiesta), ['accent']);
  assert.deepEqual(await one('SALÓN ' + W.fiesta.toUpperCase() + ' malaga'), ['accent']);
  assert.deepEqual(await one(W.fiesta + ' sàlon'), ['accent'], 'a different accent than the stored one');
  assert.deepEqual(await one('елка ' + W.party), ['cyrillic']);
  assert.deepEqual(await one('ЁЛКА ' + W.party.slice(0, 6).toUpperCase()), ['cyrillic']);
  assert.deepEqual(titles(await run('jose ' + W.ez, {type: 'people'}), 'people'), ['José ' + W.ez]);
  assert.deepEqual(hits((await run('jose ' + W.ez, {type: 'people'})).groups.people[0].title), ['José', W.ez]);
});
test('profiles: hidden and banned never appear, blocks hide both sides, schools have their own tab, nothing private leaks', async () => {
  const anonymous = await run(W.ova);
  assert.deepEqual(titles(anonymous, 'people').sort(), ['Anna ' + W.ova, 'Blocker ' + W.ova]);
  assert.deepEqual(titles(anonymous, 'schools'), ['Escuela ' + W.ova]);
  assert.deepEqual([anonymous.counts.people, anonymous.counts.schools], [2, 1]);
  assert.equal(anonymous.groups.schools[0].path, '/schools/' + profiles.school.handle);
  assert.deepEqual(titles(await run(W.ova, {type: 'people'}, profiles.anna.id), 'people'), ['Anna ' + W.ova], 'the blocked person does not see the blocker');
  assert.deepEqual(titles(await run(W.ova, {type: 'people'}, profiles.blocker.id), 'people'), ['Blocker ' + W.ova], 'the blocker does not see the blocked person');
  assert.deepEqual(titles(await run(W.ova, {type: 'people'}, profiles.jose.id), 'people').length, 2);
  // By handle, with or without @, and by a word of the bio (also in Cyrillic).
  assert.deepEqual(titles(await run('@' + profiles.anna.handle, {type: 'people'}), 'people'), ['Anna ' + W.ova]);
  assert.deepEqual(titles(await run(W.swing, {type: 'people'}), 'people'), ['José ' + W.ez]);
  assert.deepEqual(titles(await run(W.school, {type: 'schools'}), 'schools'), ['Escuela ' + W.ova]);
  const json = JSON.stringify(anonymous);
  for (const secret of ['55.75', '37.61', '@example.test', '"lat"', '"lng"', '"email"', '"userId"']) assert.equal(json.includes(secret), false, secret + ' must not be in the response');
});
test('posts and venues: drafts, hidden rows and posts of hidden authors are absent', async () => {
  const blog = await run(W.blog);
  assert.deepEqual(titles(blog, 'posts'), [W.blog + ' about musicality']);
  assert.equal(blog.counts.posts, 1);
  assert.deepEqual([blog.groups.posts[0].path, blog.groups.posts[0].author], ['/people/' + profiles.jose.handle + '/posts/srch-public-' + tag, 'José ' + W.ez]);
  assert.deepEqual(hits((await run(W.rhythm, {type: 'posts'})).groups.posts[0].snippet), [W.rhythm], 'the excerpt is searched');
  const venues = await run(W.ballroom, {type: 'venues'});
  assert.deepEqual([titles(venues, 'venues'), venues.counts.venues], [['Sala ' + W.ballroom], 1]);
  assert.deepEqual(titles(await run(W.calle, {type: 'venues'}), 'venues'), ['Sala ' + W.ballroom], 'the address is searched');
});
test('facets, city filter, localized city names and pagination', async () => {
  const all = await run(W.fest);
  assert.deepEqual(all.counts, {events: 3, people: 0, schools: 0, posts: 0, venues: 0});
  assert.equal(all.total, 3);
  const madrid = await run(W.fest, {type: 'events', city: 'madrid', locale: 'ru'});
  assert.deepEqual([madrid.counts.events, madrid.city, madrid.groups.events[0].city], [2, {id: 'madrid', slug: 'madrid', name: 'Мадрид'}, 'Мадрид']);
  assert.equal((await run(W.fest, {type: 'events', city: 'moscow', locale: 'es'})).groups.events[0].city, 'Moscú');
  assert.deepEqual([(await run(W.ova, {city: 'madrid'})).counts.people, (await run(W.ez, {city: 'madrid'})).counts.people], [0, 1]);
  const first = await run(W.fest, {type: 'events', limit: 2});
  assert.deepEqual([first.groups.events.length, first.counts.events, first.nextCursor], [2, 3, '2']);
  const second = await run(W.fest, {type: 'events', limit: 2, cursor: '2'});
  assert.deepEqual([second.groups.events.length, second.nextCursor], [1, null]);
  assert.equal(new Set([...first.groups.events, ...second.groups.events].map(hit => hit.id)).size, 3);
  // Other tabs keep their counts while one tab is open.
  assert.equal((await run(W.ova, {type: 'events'})).counts.people, 2);
});
test('SQL injection attempts and markup in queries are inert', async () => {
  const mine = () => Promise.all([db.event.count({where: {id: {in: ids.events}}}), db.profile.count({where: {userId: {in: ids.users}}}), db.post.count({where: {profile: {userId: {in: ids.users}}}}),
    db.event.count({where: {status: 'PUBLISHED', hiddenAt: null}})]);
  const before = await mine();
  const attacks = [`'; DROP TABLE "Event"; --`, `x' OR '1'='1`, `%' OR 1=1 --`, `\\'; SELECT pg_sleep(5); --`, `') || to_tsquery('simple','a:*') --`, `a:* | b:*`, `!(a) & <-> :* ((`,
    `${W.fest}'); DELETE FROM "Profile"; --`, `"unbalanced quote`, `-`, `$1 $2 \${q}`, `<script>alert(1)</script>`, 'null\u0000byte', '\\', `'`, `::text <% e.title OR true`,
    `${W.none}' OR true) --`, `${W.none}:* | ${W.fest.slice(0, 1)}:*`];
  for (const q of attacks) {
    try {
      const result = await run(q);
      // The query stays a literal: it may match rows that really contain these words, never "every row".
      assert.ok(result.counts.events < before[3], q + ' matched ' + result.counts.events + ' of ' + before[3] + ' public events');
    } catch (error) {assert.ok(error instanceof ApiError && error.code === 'QUERY_TOO_SHORT', q + ': ' + String(error));}
  }
  assert.equal((await run(`${W.none}' OR true) --`)).total, 0);
  assert.equal((await run(`${W.none}:* | ${W.fest.slice(0, 1)}:*`)).total, 0, 'tsquery operators typed by the user are not operators');
  const after = await mine();
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  // The same goes for the city parameter and for stored markup, which comes back as text segments.
  await assert.rejects(run(W.fest, {city: `madrid' OR '1'='1`}), (error: unknown) => error instanceof ApiError && error.code === 'CITY_NOT_FOUND');
  const stored = (await run(W.markup, {type: 'events'})).groups.events[0];
  assert.equal(text(stored.title), W.markup + ' <script>alert(1)</script> & "quotes"');
  assert.equal(text(stored.snippet), '<img src=x onerror=alert(1)> ' + W.markup);
  assert.deepEqual(hits(stored.title), [W.markup]);
});
test('EXPLAIN: the search conditions are answered from the GIN indexes', async () => {
  // 5 000 filler rows per table exist only inside this transaction, which is always rolled back. At that size the planner may
  // still prefer a sequential or full B-tree scan. Disable those alternatives for this transaction: this checks GIN
  // eligibility, not the production planner's preferred plan or a latency target. Populate both profile types so a
  // school lookup is not trivially answered by the city/type index finding the only school in the fixture.
  const bulk = 'xpl' + tag, input = {q: W.fest + ' lindy', limit: 20, offset: 0}, plans: Record<string, string> = {};
  const rolledBack = new Error('ROLLBACK');
  await assert.rejects(db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO "Event" (id, slug, title, description, "startsAt", timezone, "cityId", status, "updatedAt")
      SELECT ${bulk} || g, ${bulk} || g, 'Bulk ' || md5(g::text), 'Text ' || md5((g * 7)::text), now(), 'Europe/Madrid', 'madrid', 'PUBLISHED', now() FROM generate_series(1, 5000) g`;
    await tx.$executeRaw`INSERT INTO "Profile" (id, type, handle, name, bio, "updatedAt")
      SELECT ${bulk} || g, (CASE WHEN g % 2 = 0 THEN 'SCHOOL' ELSE 'DANCER' END)::"ProfileType", ${bulk} || g, 'Bulk ' || md5(g::text), 'Bio ' || md5((g * 7)::text), now() FROM generate_series(1, 5000) g`;
    await tx.$executeRaw`INSERT INTO "Post" (id, slug, "profileId", title, excerpt, content, "publishedAt")
      SELECT ${bulk} || g, ${bulk} || g, ${bulk} || '1', 'Bulk ' || md5(g::text), 'Excerpt ' || md5((g * 7)::text), '{}'::jsonb, now() FROM generate_series(1, 5000) g`;
    await tx.$executeRaw`ANALYZE "Event"`; await tx.$executeRaw`ANALYZE "Profile"`; await tx.$executeRaw`ANALYZE "Post"`;
    await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
    await tx.$executeRaw`SET LOCAL enable_indexscan = off`;
    await tx.$executeRaw`SET LOCAL enable_indexscan = off`;
    await tx.$executeRaw`SET LOCAL enable_indexonlyscan = off`;
    await tx.$queryRaw(similaritySql());
    const plan = async (sql: Prisma.Sql) => (await tx.$queryRaw<{'QUERY PLAN': string}[]>(Prisma.sql`EXPLAIN ${sql}`)).map(row => row['QUERY PLAN']).join('\n');
    plans.events = await plan(eventsSql(input)); plans.phrase = await plan(eventsSql({...input, q: '"' + W.fest + ' lindy"'}));
    plans.people = await plan(profilesSql(input, false)); plans.schools = await plan(profilesSql(input, true)); plans.posts = await plan(postsSql(input));
    throw rolledBack;
  }, {timeout: 60000, maxWait: 15000}), rolledBack);
  assert.equal(await db.event.count({where: {id: {startsWith: bulk}}}), 0, 'the filler rows are gone');
  for (const key of ['events', 'people']) assert.match(plans[key], /BitmapOr/, key);
  assert.match(plans.events, /Bitmap Index Scan on event_search_idx/);
  assert.match(plans.events, /Bitmap Index Scan on event_title_trgm_idx/);
  assert.doesNotMatch(plans.events, /Seq Scan on "Event"/);
  assert.match(plans.people, /Bitmap Index Scan on profile_search_idx/);
  assert.match(plans.people, /Bitmap Index Scan on profile_name_trgm_idx/);
  // The school predicate may be cheaper through the city/type index. Both variants use the identical full-text
  // expression (proven GIN-eligible by the people plan); do not pin the planner to one valid school access path.
  assert.match(plans.schools, /Bitmap Index Scan on (profile_search_idx|"Profile_cityId_type_idx")/);
  assert.doesNotMatch(plans.schools, /Seq Scan on "Profile"/);
  assert.doesNotMatch(plans.people, /Seq Scan on "Profile"/);
  assert.match(plans.posts, /Bitmap Index Scan on post_search_idx/);
  assert.doesNotMatch(plans.posts, /Seq Scan on "Post"/);
  // Quoted phrases skip the trigram arm and still use the full-text index.
  assert.match(plans.phrase, /Bitmap Index Scan on event_search_idx/);
  assert.doesNotMatch(plans.phrase, /trgm/);
});
test('GET /api/search: JSON shape, private caching, error codes and a rate limit with Retry-After', async () => {
  resetMemoryRateLimits();
  const ip = '203.0.113.' + Math.floor(Math.random() * 250), get = (query: string) => route.GET(new Request(base + '/api/search?' + query, {headers: {'x-real-ip': ip}}));
  const ok = await get('q=' + W.fest + '&type=events&locale=es');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  const body = await ok.json() as SearchResult;
  assert.deepEqual([body.q, body.type, body.counts.events, body.groups.events.length], [W.fest, 'events', 3, 3]);
  assert.deepEqual(Object.keys(body.groups.events[0]).sort(), ['city', 'id', 'path', 'snippet', 'startsAt', 'timezone', 'title', 'type', 'upcoming', 'venue']);
  const failed = async (query: string) => {const response = await get(query); return [response.status, (await response.json()).error];};
  assert.deepEqual(await failed('q=a'), [400, 'QUERY_TOO_SHORT']);
  assert.deepEqual(await failed(''), [400, 'QUERY_TOO_SHORT']);
  assert.deepEqual(await failed('q=lindy&type=everything'), [400, 'INVALID_INPUT']);
  assert.deepEqual(await failed('q=lindy&city=atlantis'), [400, 'CITY_NOT_FOUND']);
  let limited: Response | undefined;
  for (let i = 0; i < 100 && !limited; i++) {const response = await get('q=a'); if (response.status === 429) limited = response;}
  assert.ok(limited, 'the limit is reached within 100 requests');
  assert.equal((await limited.json()).error, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});
