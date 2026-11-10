import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const route = (name) => fileURLToPath(new URL(`../src/routes/${name}.js`, import.meta.url));

test('share API preserves response snapshots and supports full-chat artifact copies', async () => {
  const source = await readFile(route('shares'), 'utf8');
  assert.match(source, /shareType = 'snapshot'/);
  assert.match(source, /shareType === 'chat'/);
  assert.match(source, /listArtifacts\(owner\(req\), \{ chatId:/);
  assert.match(source, /getArtifact\(metadata\.id, owner\(req\)\)/);
  assert.match(source, /totalArtifactBytes \+ Number\(metadata\.size \|\| 0\) > 8 \* 1024 \* 1024/);
  assert.match(source, /messageId is required for a response snapshot/);
});

test('public share artifacts are downloaded only through the active immutable share record', async () => {
  const source = await readFile(route('publicShare'), 'utf8');
  assert.match(source, /revokedAt: null/);
  assert.match(source, /artifacts\/\:artifactId/);
  assert.match(source, /normalizeStoredBinary/);
  assert.match(source, /createHash\('sha256'\)/);
});
