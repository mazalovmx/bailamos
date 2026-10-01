import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db} from '@dance/db';
import {coarsen, haversine, publicLocation} from '../src/lib/geo/coarsen';
import {bboxSchema, nearbySchema, reverseSchema, searchSchema, venueSchema} from '../src/lib/geo/params';
import {bboxEvents, nearbyEvents, nearestCity} from '../src/lib/geo/nearby';
import {cacheKey, geocode, reverseGeocode, suggest} from '../src/lib/geo/geocode';
import {headerHints, locate} from '../src/lib/geo/locate';
import {rateLimit} from '../src/lib/geo/rate-limit';
config({path: '../../.env', quiet: true});
const tag = 'geotest-' + randomUUID().slice(0, 8);
after(async () => { await db.$disconnect(); });

test('coarsening hides the exact position but stays within about a kilometre', () => {
  const home = {lat: 40.416775, lng: -3.70379}, coarse = coarsen(home.lat, home.lng);
  assert.notDeepEqual(coarse, home);
  const shift = haversine(home, coarse);
  assert.ok(shift > 1 && shift < 1300, 'shifted by ' + shift + ' m');
  assert.deepEqual(coarsen(coarse.lat, coarse.lng), coarse, 'idempotent');
  // Neighbours 60 m apart become indistinguishable.
  assert.deepEqual(coarsen(40.4120, -3.7040), coarsen(40.4125, -3.7043));
  // The grid stays about as wide in the far north as at the equator.
  for (const [lat, lng] of [[69.6492, 18.9553], [0.3476, 32.5825], [-54.8019, -68.303], [59.9343, 179.99]]) {
    const cell = coarsen(lat, lng);
    assert.ok(haversine({lat, lng}, cell) < 1300 && Math.abs(cell.lat) <= 90 && Math.abs(cell.lng) <= 180);
  }
  assert.throws(() => coarsen(91, 0), RangeError);
  assert.throws(() => coarsen(Number.NaN, 0), RangeError);
});
test('a public profile location is only city and district', () => {
  const shown = publicLocation({district: ' Lavapiés ', lat: 40.4087, lng: -3.7003, city: {id: 'madrid', slug: 'madrid', name: 'Madrid'}});
  assert.deepEqual(shown, {city: {id: 'madrid', slug: 'madrid', name: 'Madrid'}, district: 'Lavapiés'});
  assert.equal(JSON.stringify(shown).includes('40.4'), false);
  assert.deepEqual(publicLocation({lat: 1, lng: 2}), {city: null, district: null});
});
test('radius and viewport parameters are validated strictly', () => {
  const now = Date.now(), ok = nearbySchema.parse({lat: '40.4168', lng: '-3.7038', style: []});
  assert.equal(ok.radiusKm, 25);
  assert.equal(ok.limit, 100);
  assert.ok(Math.abs(ok.from.getTime() - now) < 5000 && Math.abs(ok.to.getTime() - now - 7 * 86400000) < 5000, 'defaults to the next 7 days');
  const custom = nearbySchema.parse({lat: '40', lng: '-3', radiusKm: '7.5', limit: '500', style: ['swing,solo-jazz', 'balboa'], from: '2030-01-01', to: '2030-01-07'});
  assert.deepEqual(custom.style, ['swing', 'solo-jazz', 'balboa']);
  assert.equal(custom.radiusKm, 7.5);
  assert.equal(custom.to.toISOString(), '2030-01-08T00:00:00.000Z', 'a date-only end includes that day');
  const bad: Record<string, unknown>[] = [
    {lng: '-3'}, {lat: '', lng: '-3'}, {lat: 'abc', lng: '-3'}, {lat: '91', lng: '0'}, {lat: '40', lng: '181'}, {lat: '4e1', lng: '0'}, {lat: '40 OR 1=1', lng: '0'},
    {lat: '40', lng: '-3', radiusKm: '0'}, {lat: '40', lng: '-3', radiusKm: '201'}, {lat: '40', lng: '-3', radiusKm: '-5'},
    {lat: '40', lng: '-3', limit: '49'}, {lat: '40', lng: '-3', limit: '501'}, {lat: '40', lng: '-3', limit: '1e2'},
    {lat: '40', lng: '-3', style: ["swing'; DROP TABLE \"Event\"; --"]},
    {lat: '40', lng: '-3', from: 'tomorrow'}, {lat: '40', lng: '-3', from: '2030-02-01', to: '2030-01-01'}, {lat: '40', lng: '-3', from: '2030-01-01', to: '2032-01-01'}
  ];
  for (const input of bad) assert.equal(nearbySchema.safeParse({style: [], ...input}).success, false, JSON.stringify(input));
  assert.deepEqual(bboxSchema.parse({bbox: '-3.9,40.3,-3.5,40.6', style: []}).bbox, [-3.9, 40.3, -3.5, 40.6]);
  for (const bbox of ['-3.9,40.3,-3.5', '-3.9,40.6,-3.5,40.3', '-190,40,-3,41', 'a,b,c,d', '']) assert.equal(bboxSchema.safeParse({bbox, style: []}).success, false, bbox);
  assert.equal(bboxSchema.safeParse({bbox: '-3.9,40.3,-3.5,40.6', style: [], limit: '2001'}).success, false);
  assert.equal(searchSchema.safeParse({q: 'ab'}).success, false);
  assert.equal(reverseSchema.safeParse({lat: '40'}).success, false);
  assert.equal(venueSchema.safeParse({name: 'Hall', cityId: 'madrid'}).success, false, 'needs an address or coordinates');
  assert.equal(venueSchema.safeParse({name: 'Hall', cityId: 'madrid', lat: 40.4}).success, false, 'half a coordinate');
  assert.equal(venueSchema.safeParse({name: 'Hall', cityId: 'madrid', lat: 40.4, lng: -3.7}).success, true);
});
test('radius and viewport queries return only visible upcoming events, nearest first', {timeout: 60000}, async () => {
  // A remote patch of the South Pacific keeps this test apart from real and seeded data.
  const base = {lat: -48.8767, lng: -123.3933}, north = (km: number) => ({lat: base.lat + km / 111.2, lng: base.lng});
  const soon = new Date(Date.now() + 2 * 86400000), from = new Date(), to = new Date(Date.now() + 7 * 86400000);
  const city = await db.city.findUniqueOrThrow({where: {slug: 'madrid'}});
  const venue = await db.venue.create({data: {name: tag, address: 'Test', cityId: city.id, ...north(3)}});
  const make = (key: string, data: object, occurrence: object | null = {}) => db.event.create({data: {
    id: tag + '-' + key, slug: tag + '-' + key, title: 'Geo test ' + key, startsAt: soon, timezone: city.timezone, cityId: city.id, status: 'PUBLISHED', ...data,
    ...(occurrence ? {occurrences: {create: {startsAt: soon, ...occurrence}}} : {})
  }});
  try {
    await make('centre', {...base, styles: {create: {styleId: 'solo-jazz'}}});
    await make('venue', {venueId: venue.id});
    await make('ten', {...north(10), styles: {create: {styleId: 'bachata-sensual'}}});
    await make('far', north(40));
    await make('draft', {...base, status: 'DRAFT'});
    await make('hidden', {...base, hiddenAt: new Date()});
    await make('cancelled', base, {cancelled: true});
    await make('later', base, {startsAt: new Date(Date.now() + 30 * 86400000)});
    await make('past', {...base, startsAt: new Date(Date.now() - 86400000)}, {startsAt: new Date(Date.now() - 86400000)});
    const keys = (rows: {id: string}[]) => rows.map(row => row.id.replace(tag + '-', ''));
    const near = await nearbyEvents({...base, radiusKm: 25, from, to, limit: 100});
    assert.deepEqual(keys(near), ['centre', 'venue', 'ten']);
    assert.ok(near[0].distanceM! < 1 && Math.abs(near[1].distanceM! - 3000) < 50 && Math.abs(near[2].distanceM! - 10000) < 100, 'distances in metres');
    assert.equal(near[0].styles.length, 1);
    assert.equal(near[1].venue, tag);
    assert.ok(Math.abs(near[1].lat - north(3).lat) < 1e-9, 'an event without coordinates is placed at its venue');
    assert.equal(near[0].startsAt.getTime(), soon.getTime());
    assert.deepEqual(keys(await nearbyEvents({...base, radiusKm: 5, from, to, limit: 100})), ['centre', 'venue']);
    assert.deepEqual(keys(await nearbyEvents({...base, radiusKm: 50, from, to, limit: 100})), ['centre', 'venue', 'ten', 'far']);
    assert.deepEqual(keys(await nearbyEvents({...base, radiusKm: 50, from, to, limit: 2})), ['centre', 'venue']);
    assert.ok(keys(await nearbyEvents({...base, radiusKm: 25, from, to: new Date(Date.now() + 40 * 86400000), limit: 100})).includes('later'));
    // Style filters include descendants: "swing" through the built-in family, "bachata" through the DanceStyle tree.
    assert.deepEqual(keys(await nearbyEvents({...base, radiusKm: 50, from, to, limit: 100, style: ['swing']})), ['centre']);
    assert.deepEqual(keys(await nearbyEvents({...base, radiusKm: 50, from, to, limit: 100, style: ['bachata']})), ['ten']);
    assert.deepEqual(keys(await nearbyEvents({...base, radiusKm: 50, from, to, limit: 100, style: ['tango']})), []);
    const box = (south: number, northKm: number): [number, number, number, number] => [base.lng - 0.5, north(south).lat, base.lng + 0.5, north(northKm).lat];
    assert.deepEqual(keys(await bboxEvents({bbox: box(-1, 20), from, to, limit: 100})).sort(), ['centre', 'ten', 'venue']);
    assert.deepEqual(keys(await bboxEvents({bbox: box(5, 60), from, to, limit: 100})).sort(), ['far', 'ten']);
    assert.deepEqual(keys(await bboxEvents({bbox: [-180, -85, 180, 85], from, to, limit: 2000})).filter(key => ['centre', 'venue', 'ten', 'far', 'draft', 'hidden', 'cancelled', 'past'].includes(key)).sort(), ['centre', 'far', 'ten', 'venue']);
    // A viewport across the antimeridian (west > east) must not match this point.
    assert.deepEqual(keys(await bboxEvents({bbox: [170, -60, -170, -40], from, to, limit: 100})).filter(key => key === 'centre'), []);
    const started = performance.now();
    await nearbyEvents({lat: city.lat, lng: city.lng, radiusKm: 25, from, to, limit: 100});
    assert.ok(performance.now() - started < 1000);
  } finally {
    await db.event.deleteMany({where: {id: {startsWith: tag}}});
    await db.venue.delete({where: {id: venue.id}});
  }
});
test('city detection: explicit cookie, then proxy headers, then the default', async () => {
  const madrid = await db.city.findUniqueOrThrow({where: {slug: 'madrid'}});
  const nearest = await nearestCity(madrid.lat + 0.01, madrid.lng + 0.01);
  assert.ok(nearest && nearest.distanceM < 2000 && nearest.countryCode === 'ES');
  assert.deepEqual(headerHints(new Headers({'x-vercel-ip-latitude': '40.42', 'x-vercel-ip-longitude': '-3.70', 'x-vercel-ip-city': 'Alcal%C3%A1', 'cf-ipcountry': 'es'})),
    {lat: 40.42, lng: -3.7, city: 'Alcalá', countryCode: 'ES'});
  assert.deepEqual(headerHints(new Headers({'cf-ipcountry': 'XX', 'x-vercel-ip-latitude': 'abc', 'x-vercel-ip-longitude': '1'})), {lat: undefined, lng: undefined, city: undefined, countryCode: undefined});
  const byCoordinates = await locate(new Headers({'x-vercel-ip-latitude': String(madrid.lat), 'x-vercel-ip-longitude': String(madrid.lng)}));
  assert.equal(byCoordinates.source, 'coordinates');
  assert.equal(byCoordinates.city?.countryCode, 'ES');
  const byCookie = await locate(new Headers({cookie: 'theme=dark; city=paris', 'x-vercel-ip-latitude': String(madrid.lat), 'x-vercel-ip-longitude': String(madrid.lng)}));
  assert.equal(byCookie.source, 'cookie');
  assert.equal(byCookie.city?.slug, 'paris');
  assert.equal(byCookie.detected?.countryCode, 'ES');
  const byName = await locate(new Headers({'x-vercel-ip-city': 'MADRID', 'x-vercel-ip-country': 'ES'}));
  assert.equal(byName.source, 'city');
  // Mid-Pacific: no seeded city within reach, so an unknown cookie falls through to the default.
  const nowhere = await locate(new Headers({cookie: 'city=no-such-city', 'cf-iplatitude': '-48.87', 'cf-iplongitude': '-123.39'}));
  assert.equal(nowhere.source, 'default');
  assert.ok(nowhere.city);
  const browser = await locate(new Headers({cookie: 'city=paris'}), {lat: madrid.lat, lng: madrid.lng});
  assert.equal(browser.source, 'browser');
  assert.equal(browser.city?.countryCode, 'ES');
});
test('geocoding caches answers in the database and survives provider failures', {timeout: 60000}, async () => {
  const realFetch = globalThis.fetch, saved = {url: process.env.GEOCODER_URL, photon: process.env.PHOTON_URL, agent: process.env.GEOCODER_USER_AGENT};
  process.env.GEOCODER_URL = 'http://geocoder.test/';
  process.env.GEOCODER_USER_AGENT = 'geo-test/1.0 (test@example.test)';
  delete process.env.PHOTON_URL;
  const calls: {url: URL; agent: string | null}[] = [];
  let mode: 'ok' | 'down' | 'http500' | 'garbage' = 'ok';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({url, agent: new Headers(init?.headers).get('user-agent')});
    if (mode === 'down') throw new TypeError('fetch failed');
    if (mode === 'http500') return new Response('oops', {status: 500});
    if (mode === 'garbage') return new Response('<html>', {status: 200});
    if (url.hostname === 'photon.test') return Response.json({features: [
      {geometry: {coordinates: [-3.7038, 40.4168]}, properties: {name: 'Sala ' + tag, street: 'Calle Mayor', housenumber: '1', city: 'Madrid', country: 'España', countrycode: 'es'}},
      {geometry: {coordinates: [999, 999]}, properties: {name: 'broken'}}]});
    if (url.pathname === '/reverse') return Response.json({lat: '40.4168', lon: '-3.7038', display_name: 'Calle Mayor 1, Madrid', address: {city: 'Madrid', suburb: 'Sol', country_code: 'es'}});
    return Response.json([{lat: '40.4168', lon: '-3.7038', display_name: 'Calle Mayor 1, Madrid, España', address: {city: 'Madrid', suburb: 'Sol', country_code: 'es'}}, {lat: 'x', lon: 'y', display_name: 'broken'}]);
  }) as typeof fetch;
  // Coordinates of this run only, placed exactly on the 5-decimal grid the cache key is rounded to. A random point
  // with more decimals sat next to a rounding boundary one time in ten: "the same building" then became another cache
  // key, the provider was asked twice and the test failed (and left an untagged row behind).
  const grid = (value: number) => Number(value.toFixed(5));
  const nowhere = {lat: grid(10.5 + Math.random() / 10), lng: grid(20.5 + Math.random() / 10)};
  const lat = grid(-48.8767 + Math.random() / 100), lng = -123.3933;
  const reverseKeys = [nowhere, {lat, lng}].map(point => cacheKey('reverse', point.lat.toFixed(5) + ',' + point.lng.toFixed(5)));
  try {
    await db.geocodeCache.deleteMany({where: {key: {in: reverseKeys}}});
    const query = 'Calle Mayor 1 ' + tag;
    const first = await geocode(query, {countryCode: 'ES'});
    assert.deepEqual(first, {lat: 40.4168, lng: -3.7038, label: 'Calle Mayor 1, Madrid, España', city: 'Madrid', district: 'Sol', countryCode: 'ES'});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.origin + calls[0].url.pathname, 'http://geocoder.test/search');
    assert.equal(calls[0].url.searchParams.get('countrycodes'), 'es');
    assert.equal(calls[0].agent, 'geo-test/1.0 (test@example.test)');
    // Same query in another spelling: answered from GeocodeCache without touching the provider, even when it is down.
    mode = 'down';
    assert.deepEqual(await geocode('  CALLE   mayor 1 ' + tag.toUpperCase() + ' ', {countryCode: 'es'}), first);
    assert.equal(calls.length, 1);
    assert.ok(await db.geocodeCache.findUnique({where: {key: cacheKey('forward', query, 'ES')}}));
    // Failures give null / [] instead of throwing, and are not cached.
    for (const failure of ['down', 'http500', 'garbage'] as const) {
      mode = failure;
      assert.equal(await geocode('Unknown street ' + tag), null, failure);
      assert.equal(await reverseGeocode(nowhere.lat, nowhere.lng), null, failure);
    }
    assert.equal(await db.geocodeCache.count({where: {key: {in: [cacheKey('forward', 'Unknown street ' + tag), reverseKeys[0]]}}}), 0);
    mode = 'ok';
    assert.equal((await geocode('Unknown street ' + tag))?.city, 'Madrid');
    // An expired entry is refreshed, but still served if the provider is unavailable.
    await db.geocodeCache.update({where: {key: cacheKey('forward', query, 'ES')}, data: {createdAt: new Date(Date.now() - 200 * 86400000)}});
    mode = 'down';
    let before = calls.length;
    assert.deepEqual(await geocode(query, {countryCode: 'ES'}), first);
    assert.equal(calls.length, before + 1);
    mode = 'ok';
    assert.equal((await reverseGeocode(lat, lng))?.label, 'Calle Mayor 1, Madrid');
    before = calls.length;
    // 4 m away at most (well inside the rounding cell of 5 decimals): the same key, no second request.
    assert.equal((await reverseGeocode(lat + 0.000004, lng - 0.000004))?.district, 'Sol');
    assert.equal(calls.length, before, 'reverse lookups are cached by rounded coordinates');
    // The next cell is another key.
    assert.equal((await reverseGeocode(lat + 0.00002, lng))?.district, 'Sol');
    assert.equal(calls.length, before + 1);
    reverseKeys.push(cacheKey('reverse', (lat + 0.00002).toFixed(5) + ',' + lng.toFixed(5)));
    assert.equal(await reverseGeocode(95, 0), null);
    assert.deepEqual(await geocode('ab'), null);
    // Autocomplete goes to Photon when it is configured.
    process.env.PHOTON_URL = 'http://photon.test';
    const suggestions = await suggest('Sala ' + tag, {near: {lat: 40.4168, lng: -3.7038}, lang: 'en'});
    assert.deepEqual(suggestions, [{lat: 40.4168, lng: -3.7038, label: 'Sala ' + tag + ', Calle Mayor 1, Madrid, España', city: 'Madrid', district: undefined, countryCode: 'ES'}]);
    const photonCall = calls[calls.length - 1].url;
    assert.equal(photonCall.origin + photonCall.pathname, 'http://photon.test/api');
    assert.equal(photonCall.searchParams.get('lat'), '40.4');
    before = calls.length;
    assert.equal((await suggest('sala ' + tag, {near: {lat: 40.42, lng: -3.69}, lang: 'en'})).length, 1);
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of [['GEOCODER_URL', saved.url], ['PHOTON_URL', saved.photon], ['GEOCODER_USER_AGENT', saved.agent]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await db.geocodeCache.deleteMany({where: {OR: [{key: {contains: tag}}, {key: {in: reverseKeys}}]}});
  }
});
test('the shared public geocoder is never used for autocomplete', async () => {
  const saved = {url: process.env.GEOCODER_URL, photon: process.env.PHOTON_URL}, realFetch = globalThis.fetch;
  delete process.env.GEOCODER_URL; delete process.env.PHOTON_URL;
  let called = 0;
  globalThis.fetch = (async () => { called++; throw new Error('no network in tests'); }) as typeof fetch;
  try {
    assert.deepEqual(await suggest('Gran Vía ' + tag), []);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (saved.url !== undefined) process.env.GEOCODER_URL = saved.url;
    if (saved.photon !== undefined) process.env.PHOTON_URL = saved.photon;
  }
});
test('rate limiting counts requests per key and window', async () => {
  const key = tag + ':' + randomUUID();
  try {
    for (let i = 0; i < 3; i++) assert.equal(await rateLimit(key, 3, 60), true);
    assert.equal(await rateLimit(key, 3, 60), false);
    assert.equal(await rateLimit(key + ':other', 3, 60), true);
    // A new window starts once the old one has passed.
    await db.rateLimit.update({where: {key: 'geo:' + key}, data: {lastRequest: BigInt(Date.now() - 61000)}});
    assert.equal(await rateLimit(key, 3, 60), true);
  } finally {
    await db.rateLimit.deleteMany({where: {key: {startsWith: 'geo:' + tag}}});
  }
});
