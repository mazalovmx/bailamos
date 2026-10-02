import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {URL} from 'node:url';
function assertSame(catalogues) {
  const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === 'object' && !Array.isArray(item) ? flatten(item, prefix + key + '.') : [[prefix + key, item]]);
  const first = flatten(catalogues[0]);
  const keys = first.map(([key]) => key).sort();
  for (const catalogue of catalogues) {
    const entries = flatten(catalogue);
    assert.deepEqual(entries.map(([key]) => key).sort(), keys);
    for (const [, value] of entries) assert.ok(typeof value === 'string' && value.trim().length > 0);
  }
}
test('all launch languages contain the same non-empty messages', async () => {
  assertSame(await Promise.all(['ru','en','es'].map(async locale =>
    JSON.parse(await readFile(new URL('../apps/web/messages/' + locale + '.json', import.meta.url), 'utf8')).Home)));
});
test('all application screens and errors are translated into en, es and ru', async () => {
  assertSame(await Promise.all(['en','es','ru'].map(async locale =>
    JSON.parse(await readFile(new URL('../apps/web/messages/app/' + locale + '.json', import.meta.url), 'utf8')))));
});
test('every feature namespace is translated into en, es and ru', async () => {
  const root = new URL('../apps/web/messages/features/', import.meta.url);
  for (const name of await readdir(root))
    assertSame(await Promise.all(['en','es','ru'].map(async locale =>
      JSON.parse(await readFile(new URL(name + '/' + locale + '.json', root), 'utf8')))));
});
