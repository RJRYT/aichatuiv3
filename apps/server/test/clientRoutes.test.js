import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const appFile = fileURLToPath(new URL('../../client/src/App.jsx', import.meta.url));

test('client supports canonical chat URLs, history navigation, and deletion state', async () => {
  const source = await readFile(appFile, 'utf8');
  assert.match(source, /history\.pushState\(\{\}, '', `\/c\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(source, /addEventListener\('popstate'/);
  assert.match(source, /deletingChatIds/);
  assert.match(source, /history\.replaceState\(\{\}, '', '\/'\)/);
});

test('client consumes OAuth feedback query parameters and adds full-chat sharing', async () => {
  const source = await readFile(appFile, 'utf8');
  assert.match(source, /feedbackQuery\.delete\('auth_error'\)/);
  assert.match(source, /const shareChat = async/);
  assert.match(source, /shareType: 'chat'/);
  assert.match(source, /SHARED CONVERSATION/);
});
