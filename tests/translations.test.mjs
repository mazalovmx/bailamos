import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {URL} from 'node:url';
test('all launch languages contain the same non-empty messages', async () => {
  const catalogues = await Promise.all(['ru','en','es'].map(async locale =>
    JSON.parse(await readFile(new URL('../apps/web/messages/' + locale + '.json', import.meta.url), 'utf8')).Home));
  const keys = Object.keys(catalogues[0]).sort();
  for (const catalogue of catalogues) {
    assert.deepEqual(Object.keys(catalogue).sort(), keys);
    for (const value of Object.values(catalogue)) assert.ok(typeof value === 'string' && value.trim().length > 0);
  }
});
test('all application screens and errors are translated into en, es and ru', async () => {
  const catalogues = await Promise.all(['en','es','ru'].map(async locale =>
    JSON.parse(await readFile(new URL('../apps/web/messages/app/' + locale + '.json', import.meta.url), 'utf8'))));
  const keys = Object.keys(catalogues[0]).sort();
  for (const catalogue of catalogues) {
    assert.deepEqual(Object.keys(catalogue).sort(), keys);
    for (const value of Object.values(catalogue)) assert.ok(typeof value === 'string' && value.trim().length > 0);
  }
});
