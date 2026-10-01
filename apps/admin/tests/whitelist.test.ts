// Pure checks of the resource whitelist and the message catalogues; no database connection is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {Prisma} from '@dance/db';
import {HttpError} from '../src/lib/errors';
import {inputSchema, listArgs, resource, resourceMeta, resources, selectOf, wouldCycle} from '../src/lib/resources';
const secret = /password|token|secret|hash|p256dh|^auth$|ipAddress|userAgent|^geo$|directKey|embedHtml/i;
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;
test('every whitelisted column is a real scalar column and none of them can carry a secret', () => {
  assert.equal(new Set(resources.map(item => item.name)).size, resources.length);
  for (const item of resources) {
    const model = models.get(item.modelName);
    assert.ok(model, item.modelName);
    assert.equal(item.model, item.modelName[0].toLowerCase() + item.modelName.slice(1));
    const scalars = new Set(model.fields.filter(field => field.kind !== 'object').map(field => field.name));
    for (const name of Object.keys(selectOf(item))) {
      assert.ok(scalars.has(name), item.name + '.' + name);
      assert.equal(secret.test(name), false, item.name + '.' + name);
    }
    assert.ok(scalars.has(item.label) && item.fields.some(field => field.name === item.label));
    for (const field of item.fields.filter(entry => entry.ref)) assert.ok(resources.some(target => target.name === field.ref), field.ref);
  }
});
test('credentials, sessions and push keys are not reachable through any resource', () => {
  const exposed = new Set(resources.map(item => item.modelName));
  for (const model of ['Session', 'Account', 'Verification', 'PushSubscription', 'RateLimit', 'EventInvite', 'TelegramChat']) assert.equal(exposed.has(model), false, model);
  assert.throws(() => resource('sessions'), code('NOT_FOUND'));
  assert.throws(() => resource('accounts'), code('NOT_FOUND'));
  const users = resource('users');
  assert.deepEqual(Object.keys(selectOf(users)).sort(),
    ['ageConfirmed', 'banReason', 'bannedAt', 'createdAt', 'email', 'emailVerified', 'id', 'locale', 'name', 'role', 'updatedAt']);
  // Exact coordinates of people are never published, not even in the panel.
  for (const hiddenColumn of ['lat', 'lng']) assert.equal(hiddenColumn in selectOf(resource('profiles')), false);
  assert.equal(JSON.stringify(resourceMeta('ADMIN')).includes('password'), false);
});
test('writes accept only writable columns: roles, bans, ownership, visibility and ids are rejected', () => {
  for (const item of resources) {
    for (const key of ['id', 'role', 'bannedAt', 'banReason', 'userId', 'hiddenAt', 'createdAt', 'emailVerified', 'password'])
      for (const mode of ['create', 'update'] as const)
        assert.equal(inputSchema(item, mode).safeParse({[key]: 'x'}).success, false, item.name + '.' + key);
    if (!item.create && !item.update) assert.equal(item.fields.some(field => field.write), false, item.name);
  }
  for (const name of ['users', 'reports', 'claims', 'audit-log', 'conversations', 'imported-items']) {
    const item = resource(name);
    assert.deepEqual([item.create, item.update], [undefined, undefined], name);
  }
  assert.equal(resource('audit-log').remove, undefined);
  assert.deepEqual([resource('cities').remove, resource('styles').remove, resource('import-sources').remove], ['ADMIN', 'ADMIN', 'ADMIN']);
  const meta = (role: string) => resourceMeta(role).find(item => item.name === 'cities');
  assert.deepEqual([meta('MODERATOR')?.canDelete, meta('ADMIN')?.canDelete, meta('MODERATOR')?.canUpdate], [false, true, true]);
});
test('input validation: required columns, patterns, ranges and empty optional text', () => {
  const cities = inputSchema(resource('cities'), 'create');
  const city = {slug: 'porto', name: 'Porto', countryCode: 'PT', timezone: 'Europe/Lisbon', lat: 41.15, lng: -8.61};
  assert.deepEqual(cities.parse(city), city);
  assert.equal(cities.safeParse({...city, slug: 'Porto City'}).success, false);
  assert.equal(cities.safeParse({...city, countryCode: 'pt'}).success, false);
  assert.equal(cities.safeParse({...city, lat: 91}).success, false);
  assert.equal(cities.safeParse({name: 'Porto'}).success, false);
  const profiles = inputSchema(resource('profiles'), 'update');
  assert.deepEqual(profiles.parse({bio: '  ', name: ' Studio '}), {bio: null, name: 'Studio'});
  assert.equal(profiles.safeParse({name: null}).success, false);
  assert.equal(profiles.safeParse({type: 'ROBOT'}).success, false);
  assert.equal(profiles.safeParse({handle: '<script>'}).success, false);
  assert.deepEqual(inputSchema(resource('styles'), 'update').parse({parentId: ''}), {parentId: null});
  assert.deepEqual(inputSchema(resource('events'), 'update').parse({partnerRequired: null, status: 'CANCELLED'}), {partnerRequired: null, status: 'CANCELLED'});
});
test('list arguments: pagination limits, whitelisted filters and sorting, search', () => {
  const users = resource('users');
  const args = listArgs(users, new URLSearchParams('page=3&pageSize=5000&role=ADMIN&bannedAt__null=false&q=ann&sort=email&order=desc'));
  assert.deepEqual([args.skip, args.take], [400, 200]);
  assert.deepEqual(args.orderBy, [{email: 'desc'}, {id: 'asc'}]);
  assert.deepEqual(args.where, {AND: [{role: 'ADMIN'}, {bannedAt: {not: null}},
    {OR: [{id: 'ann'}, {name: {contains: 'ann', mode: 'insensitive'}}, {email: {contains: 'ann', mode: 'insensitive'}}]}]});
  assert.deepEqual(args.select, selectOf(users));
  assert.deepEqual(listArgs(users, new URLSearchParams()).orderBy, [{createdAt: 'desc'}, {id: 'asc'}]);
  for (const query of ['banReason=x', 'password=x', 'role=ROOT', 'emailVerified=maybe', 'role__like=A', 'sessions__some=1'])
    assert.throws(() => listArgs(users, new URLSearchParams(query)), code('INVALID_FILTER'), query);
  assert.throws(() => listArgs(users, new URLSearchParams('sort=banReason')), code('INVALID_SORT'));
  const audit = listArgs(resource('audit-log'), new URLSearchParams('actorUserId=u1&action__contains=BAN&targetType=User&createdAt__gte=2026-01-01T00:00:00Z'));
  assert.deepEqual(audit.where, {AND: [{actorUserId: 'u1'}, {action: {contains: 'BAN', mode: 'insensitive'}}, {targetType: 'User'}, {createdAt: {gte: new Date('2026-01-01T00:00:00Z')}}]});
});
test('the style tree refuses cycles', async () => {
  const parents: Record<string, string | null> = {swing: null, lindy: 'swing', 'lindy-fast': 'lindy', balboa: 'swing'};
  const parentOf = async (id: string) => parents[id];
  assert.equal(await wouldCycle('swing', 'lindy-fast', parentOf), true);
  assert.equal(await wouldCycle('lindy', 'lindy', parentOf), true);
  assert.equal(await wouldCycle('lindy', 'balboa', parentOf), false);
  assert.equal(await wouldCycle('balboa', 'missing', parentOf), false);
});
test('the panel is fully translated into en, es and ru', async () => {
  const [en, es, ru] = await Promise.all(['en', 'es', 'ru'].map(async locale =>
    JSON.parse(await readFile(new URL('../messages/' + locale + '.json', import.meta.url), 'utf8')) as Record<string, string>));
  for (const catalogue of [es, ru]) assert.deepEqual(Object.keys(catalogue).sort(), Object.keys(en).sort());
  for (const catalogue of [en, es, ru]) for (const [key, value] of Object.entries(catalogue)) {
    assert.ok(typeof value === 'string' && value.trim(), key);
    assert.deepEqual(value.match(/\{\w+\}/g)?.sort() ?? [], en[key].match(/\{\w+\}/g)?.sort() ?? [], key);
  }
  for (const item of resources) {
    assert.ok(en['resource.' + item.name], item.name);
    for (const field of item.fields) assert.ok(en['field.' + field.name], 'field.' + field.name);
  }
  // Every literal key passed to t() in the sources exists, so no screen falls back to a raw key.
  const files: string[] = [];
  const walk = async (directory: URL) => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const next = new URL(encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await walk(next); else if (/\.tsx?$/.test(entry.name)) files.push(await readFile(next, 'utf8'));
    }
  };
  await walk(new URL('../src/', import.meta.url));
  const used = files.flatMap(source => [...source.matchAll(/\bt\('([A-Za-z][\w.-]*)'[,)]/g)].map(match => match[1]));
  assert.ok(used.length > 80);
  for (const key of used) assert.ok(en[key], key);
  for (const errorCode of files.flatMap(source => [...source.matchAll(/(?:HttpError|ModerationError)\('([A-Z_]+)'/g)].map(match => match[1])))
    assert.ok(en['error.' + errorCode], 'error.' + errorCode);
});
