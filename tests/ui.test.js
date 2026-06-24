import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('no manual override selects remain (all market outlook strategies automated)', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/<select/g) ?? []).length, 0);
});
