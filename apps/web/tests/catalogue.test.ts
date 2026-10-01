import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {DateTime, IANAZone} from 'luxon';
import {styleTree} from '../../../packages/db/prisma/data/styles';
import {cities} from '../../../packages/db/prisma/data/cities';
import {normalize, rankMatches} from '../src/lib/catalogue/search';
import {cityAliases, cityLocale, cityName, localizeCities} from '../src/lib/catalogue/city-name';
import {catalogue} from '../src/lib/catalogue';
import {ancestors, buildTree, countBranch, descendantIds, hasCycle} from '../src/lib/catalogue/tree';
import {db} from '@dance/db';
import {allStyles, allCities, styleDescendantIds, upcomingOccurrences} from '../src/lib/catalogue/data';
import {follow, unfollow, followsOf, followTarget, isFollowing} from '../src/lib/catalogue/follows';
import {ApiError} from '../src/lib/api';
import * as stylesRoute from '../src/app/api/catalogue/styles/route';
import * as citiesRoute from '../src/app/api/catalogue/cities/route';
import * as followsRoute from '../src/app/api/follows/route';
config({path: '../../.env', quiet: true});
const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
after(() => db.$disconnect());
const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
test('seed data: a style tree of 170+ styles with unique stable slugs, parents first and no cycles', () => {
  assert.ok(styleTree.length >= 170, 'expected at least 170 styles, got ' + styleTree.length);
  const slugs = styleTree.map(row => row[0]);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(styleTree.map(row => normalize(row[1]))).size, styleTree.length, 'style names must be distinguishable');
  const seen = new Set<string>();
  for (const [id, name, parent] of styleTree) {
    assert.match(id, slug);
    assert.ok(name.trim() === name && name.length >= 2 && name.length <= 60, name);
    if (parent) assert.ok(seen.has(parent), id + ' is listed before its parent ' + parent);
    seen.add(id);
  }
  assert.equal(hasCycle(styleTree.map(([id, , parentId]) => ({id, parentId}))), false);
  // Slugs that existed before this change, and the families required by the specification.
  for (const id of ['salsa','bachata','tango','kizomba','swing','lindy-hop','solo-jazz','balboa','pure-balboa','bal-swing','collegiate-shag','st-louis-shag','carolina-shag',
    'charleston','solo-charleston','partner-charleston','boogie-woogie','bachata-sensual','bachata-dominican','west-coast-swing','east-coast-swing','blues','tap',
    'salsa-cubana','salsa-la','salsa-ny','salsa-cali','rueda-de-casino','bachata-moderna','urban-kiz','semba','zouk','tango-salon','tango-milonguero','tango-nuevo','tango-vals','milonga',
    'forro','ballroom-standard','ballroom-latin','hustle','fusion','folk','hip-hop']) assert.ok(seen.has(id), 'missing style ' + id);
  const parentOf = new Map(styleTree.map(row => [row[0], row[2]]));
  assert.equal(parentOf.get('west-coast-swing'), 'swing');
  assert.equal(parentOf.get('rueda-de-casino'), 'salsa-cubana');
  assert.equal(parentOf.get('swing'), null);
});
test('seed data: 60+ cities with unique slugs, valid Luxon time zones, country codes and coordinates', () => {
  assert.ok(cities.length >= 60, 'expected at least 60 cities, got ' + cities.length);
  assert.equal(new Set(cities.map(city => city.slug)).size, cities.length);
  for (const city of cities) {
    assert.match(city.slug, slug);
    assert.match(city.countryCode, /^[A-Z]{2}$/);
    assert.ok(IANAZone.isValidZone(city.timezone) && DateTime.now().setZone(city.timezone).isValid, city.slug + ' has an invalid time zone ' + city.timezone);
    assert.ok(Math.abs(city.lat) <= 90 && Math.abs(city.lng) <= 180 && (city.lat !== 0 || city.lng !== 0), city.slug);
  }
  for (const id of ['mexico-city','madrid','moscow','barcelona','saint-petersburg','buenos-aires','new-york','berlin']) assert.ok(cities.some(city => city.slug === id), id);
  // Spot-check offsets that are easy to get wrong.
  const offset = (id: string) => DateTime.fromISO('2026-01-15T12:00:00Z').setZone(cities.find(city => city.slug === id)!.timezone).offset / 60;
  assert.deepEqual(['moscow','novosibirsk','yekaterinburg','samara','buenos-aires','mexico-city','tijuana','sao-paulo'].map(offset), [3,7,5,4,-3,-6,-8,-3]);
});
test('autocomplete ranking: exact, prefix, word prefix, then substring; accents and slugs are searchable; limit applies', () => {
  const items = [{slug:'bachata',name:'Bachata'},{slug:'salsa',name:'Salsa'},{slug:'salsa-cubana',name:'Salsa Cubana (Casino)'},{slug:'salsaton',name:'Salsatón'},
    {slug:'rueda-de-casino',name:'Rueda de Casino'},{slug:'moscow',name:'Москва'},{slug:'bogota',name:'Bogotá'},{slug:'cali',name:'Cali'},{slug:'salsa-cali',name:'Salsa Caleña'}];
  assert.deepEqual(rankMatches(items, 'salsa').map(item => item.slug), ['salsa','salsa-cali','salsa-cubana','salsaton']);
  assert.deepEqual(rankMatches(items, 'cas').map(item => item.slug), ['rueda-de-casino','salsa-cubana']);
  assert.deepEqual(rankMatches(items, 'alsat').map(item => item.slug), ['salsaton']);
  assert.deepEqual(rankMatches(items, 'BOGOTA').map(item => item.slug), ['bogota']);
  assert.deepEqual(rankMatches(items, 'mosc').map(item => item.slug), ['moscow']);
  assert.deepEqual(rankMatches(items, 'моск').map(item => item.slug), ['moscow']);
  assert.deepEqual(rankMatches(items, 'cali').map(item => item.slug), ['cali','salsa-cali']);
  assert.equal(rankMatches(items, 'zzz').length, 0);
  assert.equal(rankMatches(items, '', 3).length, 3);
  assert.equal(rankMatches(items, 'a', 2).length, 2);
});
test('tree helpers: descendants, ancestors, nesting and cycle detection', () => {
  const nodes = styleTree.map(([id, name, parentId]) => ({id, slug: id, name, parentId}));
  assert.deepEqual(descendantIds(nodes, 'charleston').sort(), ['charleston','partner-charleston','solo-charleston']);
  assert.ok(['swing','lindy-hop','savoy-style-lindy','pure-balboa','west-coast-swing'].every(id => descendantIds(nodes, 'swing').includes(id)));
  assert.equal(descendantIds(nodes, 'swing').includes('salsa'), false);
  assert.deepEqual(descendantIds(nodes, 'unknown'), ['unknown']);
  assert.deepEqual(ancestors(nodes, 'rueda-de-casino').map(node => node.id), ['salsa','salsa-cubana','rueda-de-casino']);
  const roots = buildTree(nodes);
  assert.equal(roots.every(root => root.parentId === null), true);
  assert.equal(roots.reduce((sum, root) => sum + 1 + countBranch(root), 0), nodes.length);
  assert.equal(hasCycle([{id:'a',parentId:'b'},{id:'b',parentId:'a'}]), true);
  assert.deepEqual(descendantIds([{id:'a',slug:'a',name:'A',parentId:'b'},{id:'b',slug:'b',name:'B',parentId:'a'}], 'a'), ['a','b']);
});
test('follow input accepts exactly one target', () => {
  assert.deepEqual(followTarget.parse({cityId: 'madrid'}), {cityId: 'madrid'});
  for (const bad of [{}, {cityId: ''}, {cityId: 'madrid', styleId: 'salsa'}, {userId: 'x'}, {profileId: 5}, null]) assert.equal(followTarget.safeParse(bad).success, false, JSON.stringify(bad));
});
test('database: seeded catalogue has 170+ styles in an acyclic tree and only valid city time zones', async () => {
  const [styles, dbCities] = await Promise.all([allStyles(), allCities()]);
  assert.ok(styles.length >= 170, 'run pnpm db:seed first: ' + styles.length + ' styles');
  assert.equal(hasCycle(styles), false);
  const ids = new Set(styles.map(style => style.id));
  for (const style of styles) assert.ok(!style.parentId || ids.has(style.parentId));
  for (const row of styleTree) assert.ok(styles.some(style => style.slug === row[0]), 'style not seeded: ' + row[0]);
  assert.ok(dbCities.length >= 60);
  for (const city of dbCities) assert.ok(IANAZone.isValidZone(city.timezone), city.slug + ': ' + city.timezone);
  for (const id of ['mexico-city','madrid','moscow']) assert.equal(dbCities.find(city => city.slug === id)?.id, id);
  assert.ok((await styleDescendantIds('salsa')).includes('rueda-de-casino'));
});
test('autocomplete endpoints: prefix and substring matches, at most 10 items, cacheable', async () => {
  const styles = stylesRoute;
  const get = async (route: {GET: (request: Request) => Promise<Response>}, path: string) => {
    const response = await route.GET(new Request(base + path));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /public, max-age=\d+/);
    return (await response.json()).items as {id: string; slug: string; name: string; parentName?: string | null; timezone?: string; countryCode?: string}[];
  };
  const salsa = await get(styles, '/api/catalogue/styles?q=sals');
  assert.equal(salsa[0].slug, 'salsa');
  assert.ok(salsa.length > 3 && salsa.length <= 10);
  assert.equal((await get(styles, '/api/catalogue/styles?q=rueda'))[0].parentName, 'Salsa Cubana (Casino)');
  assert.ok((await get(styles, '/api/catalogue/styles?q=hop')).some(style => style.slug === 'lindy-hop'), 'substring/word match');
  assert.equal((await get(styles, '/api/catalogue/styles')).length, 10);
  assert.deepEqual(await get(styles, '/api/catalogue/styles?q=' + encodeURIComponent('%_no-such-style')), []);
  const madrid = await get(citiesRoute, '/api/catalogue/cities?q=madr');
  assert.deepEqual([madrid[0].id, madrid[0].timezone, madrid[0].countryCode], ['madrid', 'Europe/Madrid', 'ES']);
  assert.equal((await get(citiesRoute, '/api/catalogue/cities?q=bogota'))[0].slug, 'bogota');
  assert.equal((await get(citiesRoute, '/api/catalogue/cities?q=moscow'))[0].name, 'Москва');
  assert.ok((await get(citiesRoute, '/api/catalogue/cities?q=' + encodeURIComponent('петербург'))).some(city => city.slug === 'saint-petersburg'));
  assert.ok((await get(citiesRoute, '/api/catalogue/cities?q=a')).length <= 10);
});
test('seed data: every city has distinct, non-empty en, es and ru names', () => {
  assert.equal(cities.length, 97);
  for (const city of cities) {
    assert.deepEqual(Object.keys(city.names).sort(), ['en', 'es', 'ru'], city.slug);
    for (const value of Object.values(city.names)) assert.ok(value.trim() === value && value.length >= 2 && value.length <= 40, city.slug + ': ' + value);
    assert.match(city.names.ru, /^[А-Яа-яЁё .,-]+$/, city.slug + ' needs a Cyrillic name');
    assert.match(city.names.en + city.names.es, /^[\p{Script=Latin} .,'-]+$/u, city.slug + ' needs Latin names');
  }
  for (const locale of ['en', 'es', 'ru'] as const) assert.equal(new Set(cities.map(city => normalize(city.names[locale]))).size, cities.length, 'names are unique in ' + locale);
  const names = (slug: string) => Object.values(cities.find(city => city.slug === slug)!.names);
  assert.deepEqual(names('moscow'), ['Moscow', 'Moscú', 'Москва']);
  assert.deepEqual(names('cologne'), ['Cologne', 'Colonia', 'Кёльн']);
  assert.deepEqual(names('mexico-city'), ['Mexico City', 'Ciudad de México', 'Мехико']);
  assert.deepEqual(names('new-york'), ['New York', 'Nueva York', 'Нью-Йорк']);
});
test('cityName: the interface language wins, anything missing or malformed falls back to the local spelling', () => {
  const cologne = {name: 'Köln', names: {en: 'Cologne', es: 'Colonia', ru: 'Кёльн'}};
  assert.deepEqual(['en', 'es', 'ru', 'de', 'en-GB', 'RU', ''].map(locale => cityName(cologne, locale)), ['Cologne', 'Colonia', 'Кёльн', 'Köln', 'Cologne', 'Кёльн', 'Köln']);
  for (const names of [null, undefined, 'Cologne', ['Cologne'], 42, {}, {en: ''}, {en: '  '}, {en: 7}, {en: null}]) assert.equal(cityName({name: 'Köln', names}, 'en'), 'Köln', JSON.stringify(names));
  assert.deepEqual(cityAliases(cologne), ['Köln', 'Cologne', 'Colonia', 'Кёльн']);
  assert.deepEqual(cityAliases({name: 'Madrid', names: {en: 'Madrid', es: 'Madrid', ru: 'Мадрид'}}), ['Madrid', 'Мадрид']);
  assert.deepEqual(cityAliases({name: 'Madrid', names: null}), ['Madrid']);
  assert.deepEqual([cityLocale('ru'), cityLocale('de'), cityLocale(null), cityLocale('__proto__')], ['ru', null, null, null]);
  const sorted = localizeCities([{slug: 'vienna', name: 'Wien', names: {ru: 'Вена'}}, {slug: 'athens', name: 'Athens', names: {ru: 'Афины'}}, {slug: 'x', name: 'Яя', names: null}], 'ru');
  assert.deepEqual(sorted.map(city => [city.slug, city.name, city.localName]), [['athens', 'Афины', 'Athens'], ['vienna', 'Вена', 'Wien'], ['x', 'Яя', 'Яя']]);
  // Aliases widen the search, the result keeps its own order by name.
  const items = [{slug: 'cologne', ...cologne}, {slug: 'colombo', name: 'Colombo', names: null}];
  assert.deepEqual(rankMatches(items, 'colon', 10, cityAliases).map(item => item.slug), ['cologne']);
  assert.deepEqual(rankMatches(items, 'кёль', 10, cityAliases).map(item => item.slug), ['cologne']);
  assert.deepEqual(rankMatches(items, 'colon').map(item => item.slug), []);
});
test('database: all seeded cities carry en/es/ru names, and re-seeding only refreshes those names', async () => {
  const rows = await db.city.findMany({where: {slug: {in: cities.map(city => city.slug)}}});
  assert.equal(rows.length, cities.length, 'run pnpm db:seed first');
  for (const city of cities) assert.deepEqual(rows.find(row => row.slug === city.slug)?.names, city.names, city.slug);
  // The same upsert as prisma/seed.ts, on a scratch city: an edited row keeps everything but `names`.
  const slug = 'zz-test-' + randomUUID().slice(0, 8), seeded = {slug, name: 'Seeded', countryCode: 'ES', timezone: 'Europe/Madrid', lat: 1, lng: 2, names: {en: 'A', es: 'B', ru: 'В'}};
  const upsert = () => db.city.upsert({where: {slug}, create: {id: slug, ...seeded}, update: {names: seeded.names}});
  try {
    assert.deepEqual((await upsert()).names, seeded.names);
    await db.city.update({where: {slug}, data: {name: 'Edited by an admin', timezone: 'Europe/Lisbon', lat: 9, names: {en: 'stale'}}});
    const again = await upsert(), third = await upsert();
    assert.deepEqual([again.name, again.timezone, again.lat, again.lng, again.names], ['Edited by an admin', 'Europe/Lisbon', 9, 2, seeded.names]);
    assert.deepEqual(third, again);
    assert.equal(await db.city.count({where: {slug}}), 1);
  } finally {await db.city.deleteMany({where: {slug}});}
});
test('city autocomplete and catalogue: found by any of the three names or the slug, shown in the requested language', async () => {
  const get = async (query: string) => (await (await citiesRoute.GET(new Request(base + '/api/catalogue/cities?' + query))).json()).items as {id: string; slug: string; name: string; localName: string}[];
  const q = (text: string, locale?: string) => get('q=' + encodeURIComponent(text) + (locale ? '&locale=' + locale : ''));
  for (const [text, slug] of [['Moscow', 'moscow'], ['mosc', 'moscow'], ['Moscú', 'moscow'], ['moscu', 'moscow'], ['Москва', 'moscow'], ['моск', 'moscow'], ['Cologne', 'cologne'], ['colonia', 'cologne'],
    ['Кёльн', 'cologne'], ['кельн', 'cologne'], ['Köln', 'cologne'], ['koln', 'cologne'], ['Мюнхен', 'munich'], ['munchen', 'munich'], ['Múnich', 'munich'], ['Londres', 'london'], ['Лондон', 'london'],
    ['Нью-Йорк', 'new-york'], ['nueva york', 'new-york'], ['new york', 'new-york'], ['Мехико', 'mexico-city'], ['ciudad de mex', 'mexico-city'], ['Варшава', 'warsaw'], ['varsovia', 'warsaw'],
    ['warszawa', 'warsaw'], ['Estocolmo', 'stockholm'], ['Киев', 'kyiv'], ['Київ', 'kyiv'], ['habana', 'havana'], ['Гавана', 'havana'], ['saint-petersburg', 'saint-petersburg'], ['San Petersburgo', 'saint-petersburg']])
    for (const locale of [undefined, 'en', 'es', 'ru']) assert.equal((await q(text, locale))[0]?.slug, slug, text + ' in ' + locale);
  const shown = async (text: string) => Promise.all(['en', 'es', 'ru'].map(async locale => (await q(text, locale))[0].name));
  assert.deepEqual(await shown('moscow'), ['Moscow', 'Moscú', 'Москва']);
  assert.deepEqual(await shown('köln'), ['Cologne', 'Colonia', 'Кёльн']);
  assert.deepEqual(await shown('lisboa'), ['Lisbon', 'Lisboa', 'Лиссабон']);
  const [cologne] = await q('cologne', 'ru');
  assert.deepEqual([cologne.id, cologne.name, cologne.localName], ['cologne', 'Кёльн', 'Köln']);
  // Without a locale (older callers) the name stays in local spelling; an unknown locale is treated the same way.
  assert.deepEqual([(await q('cologne'))[0].name, (await q('cologne', 'de'))[0].name, (await q('cologne'))[0].localName], ['Köln', 'Köln', 'Köln']);
  // The browse list (empty query) is alphabetical in the reader's language.
  const browse = (await q('', 'ru')).map(city => city.name);
  assert.deepEqual(browse, [...browse].sort((a, b) => a.localeCompare(b, 'ru')));
  assert.match(browse[0], /^[А-Яа-яЁё]/);
  const byLocale = await Promise.all([catalogue(), catalogue('en'), catalogue('es'), catalogue('ru')]);
  assert.deepEqual(byLocale.map(data => data.cities.find(city => city.id === 'moscow')?.name), ['Москва', 'Moscow', 'Moscú', 'Москва']);
  assert.equal('names' in byLocale[1].cities[0], false);
  const ru = byLocale[3].cities.map(city => city.name);
  assert.deepEqual(ru, [...ru].sort((a, b) => a.localeCompare(b, 'ru')));
});
test('follows API refuses anonymous and cross-site callers', async () => {
  const route = followsRoute;
  assert.equal((await route.GET(new Request(base + '/api/follows'))).status, 401);
  const body = JSON.stringify({cityId: 'madrid'}), headers = {'Content-Type': 'application/json'};
  assert.equal((await route.PUT(new Request(base + '/api/follows', {method: 'PUT', headers, body}))).status, 403);
  assert.equal((await route.DELETE(new Request(base + '/api/follows', {method: 'DELETE', headers: {...headers, Origin: 'https://attacker.invalid'}, body}))).status, 403);
  assert.equal((await route.PUT(new Request(base + '/api/follows', {method: 'PUT', headers: {...headers, Origin: new URL(base).origin}, body}))).status, 401);
});
test('follows: one row per target, idempotent, a single NEW_FOLLOWER notification, hidden and own profiles refused', async () => {
  const tag = randomUUID().slice(0,8), users = ['fan','star','hidden'].map(role => ({id: 'cat-' + role + '-' + tag, name: 'Catalogue ' + role, email: 'cat-' + role + '-' + tag + '@example.test', emailVerified: true}));
  try {
    await db.user.createMany({data: users});
    const [fan, star, hidden] = await Promise.all(users.map((user, index) => db.profile.create({data: {userId: user.id, type: 'DANCER', handle: 'cat-' + index + '-' + tag, name: user.name, hiddenAt: index === 2 ? new Date() : null}})));
    const actor = {id: users[0].id, name: users[0].name, profile: fan};
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await follow(actor, {cityId: 'madrid'}), {following: true});
      assert.deepEqual(await follow(actor, {styleId: 'salsa'}), {following: true});
      assert.deepEqual(await follow(actor, {profileId: star.id}), {following: true});
    }
    const rows = await db.follow.findMany({where: {userId: actor.id}});
    assert.equal(rows.length, 3);
    for (const row of rows) assert.equal([row.cityId, row.styleId, row.profileId].filter(Boolean).length, 1, 'exactly one target per row');
    const notifications = await db.notification.findMany({where: {userId: users[1].id}});
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'NEW_FOLLOWER');
    assert.deepEqual(notifications[0].data, {followerName: fan.name, followerHandle: fan.handle, profileId: star.id, profileHandle: star.handle});
    assert.equal(notifications[0].url, '/people/' + fan.handle);
    assert.equal(await isFollowing(actor.id, {styleId: 'salsa'}), true);
    assert.equal(await isFollowing(actor.id, {styleId: 'tango'}), false);
    assert.equal(await isFollowing(undefined, {styleId: 'salsa'}), false);
    const rejected = async (target: Parameters<typeof follow>[1], code: string) =>
      assert.rejects(follow(actor, target), (error: unknown) => error instanceof ApiError && error.code === code);
    await rejected({profileId: fan.id}, 'CANNOT_FOLLOW_SELF');
    await rejected({profileId: hidden.id}, 'TARGET_NOT_FOUND');
    await rejected({cityId: 'no-such-city'}, 'TARGET_NOT_FOUND');
    await rejected({styleId: 'no-such-style'}, 'TARGET_NOT_FOUND');
    const own = await followsOf(actor.id);
    assert.deepEqual([own.cities.map(city => city.id), own.styles.map(style => style.id), own.profiles.map(profile => profile.handle)], [['madrid'], ['salsa'], [star.handle]]);
    // A profile hidden by moderation disappears from the list without deleting the subscription.
    await db.profile.update({where: {id: star.id}, data: {hiddenAt: new Date()}});
    assert.deepEqual((await followsOf(actor.id)).profiles, []);
    assert.deepEqual(await unfollow(actor.id, {cityId: 'madrid'}), {following: false});
    assert.deepEqual(await unfollow(actor.id, {cityId: 'madrid'}), {following: false});
    assert.equal(await db.follow.count({where: {userId: actor.id}}), 2);
    assert.equal(await db.follow.count({where: {userId: users[1].id}}), 0, 'nobody else is affected');
  } finally {
    await db.user.deleteMany({where: {id: {in: users.map(user => user.id)}}});
  }
});
test('public agenda query shows only published, visible, not cancelled, future occurrences, including sub-styles', async () => {
  const tag = randomUUID().slice(0,8), soon = new Date(Date.now() + 86400000), past = new Date(Date.now() - 86400000);
  const make = (name: string, data: {status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'; hiddenAt?: Date; cancelled?: boolean; startsAt?: Date; styleId?: string}) =>
    db.event.create({data: {slug: 'cat-' + name + '-' + tag, title: 'Catalogue ' + name + ' ' + tag, cityId: 'madrid', timezone: 'Europe/Madrid', startsAt: data.startsAt || soon,
      status: data.status || 'PUBLISHED', hiddenAt: data.hiddenAt, styles: {create: {styleId: data.styleId || 'rueda-de-casino'}},
      occurrences: {create: {startsAt: data.startsAt || soon, cancelled: !!data.cancelled}}}});
  const events = await Promise.all([make('visible', {}), make('draft', {status: 'DRAFT'}), make('hidden', {hiddenAt: new Date()}), make('cancelled', {status: 'CANCELLED'}),
    make('skipped', {cancelled: true}), make('past', {startsAt: past}), make('other', {styleId: 'tango-salon'})]);
  try {
    const mine = {id: {in: events.map(event => event.id)}};
    const titles = async (where: Parameters<typeof upcomingOccurrences>[0]) =>
      (await db.eventOccurrence.findMany({where: upcomingOccurrences({...where, ...mine}), include: {event: true}})).map(occurrence => occurrence.event.slug.split('-')[1]).sort();
    assert.deepEqual(await titles({styles: {some: {styleId: {in: await styleDescendantIds('salsa')}}}}), ['visible']);
    assert.deepEqual(await titles({styles: {some: {styleId: {in: await styleDescendantIds('rueda-de-casino')}}}}), ['visible']);
    assert.deepEqual(await titles({styles: {some: {styleId: {in: await styleDescendantIds('bachata')}}}}), []);
    assert.deepEqual(await titles({cityId: 'madrid'}), ['other','visible']);
    assert.deepEqual(await titles({cityId: 'moscow'}), []);
  } finally {
    await db.event.deleteMany({where: {id: {in: events.map(event => event.id)}}});
  }
});
