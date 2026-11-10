import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const routeFile = fileURLToPath(new URL('../src/routes/account.js', import.meta.url));

test('account router implements readable preferences and memories endpoints', async () => {
  const source = await readFile(routeFile, 'utf8');
  assert.match(source, /router\.get\(['"]\/preferences['"]/);
  assert.match(source, /router\.get\(['"]\/memories['"]/);
  assert.match(source, /if \(guest\(req\)\) return res\.json\(\{ preferences:/);
  assert.match(source, /if \(guest\(req\)\) return res\.json\(\{ memories: \[\] \}\)/);
});
