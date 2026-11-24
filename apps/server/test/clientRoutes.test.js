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

test('client refreshes memories through explicit sync only and offers ten persistent color presets', async () => {
  const appFile = fileURLToPath(new URL('../../client/src/App.jsx', import.meta.url));
  const stylesFile = fileURLToPath(new URL('../../client/src/styles.css', import.meta.url));
  const source = await readFile(appFile, 'utf8');
  const styles = await readFile(stylesFile, 'utf8');
  const tools = await readFile(new URL('../src/services/tools.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /addEventListener\(['"]focus['"]/);
  assert.doesNotMatch(source, /addEventListener\(['"]visibilitychange['"]/);
  assert.match(source, /localStorage\.setItem\('nemotron\.colorTheme'/);
  assert.equal(
    (
      source.match(
        /\{ id: '(?:forest|midnight|ocean|purple|rose|sunset|light|dracula|nord|solarized)'/g
      ) || []
    ).length,
    10
  );
  assert.match(source, /const progressMessage = item\.type === 'progress_update'/);
  assert.match(source, /setLiveProgress/);
  assert.match(source, /api\/chat\/stream\/active/);
  assert.match(source, /Open File Library/);
  assert.match(tools, /name: 'file_library_search'/);
  assert.match(styles, /:root\[data-theme=['\"]light['\"]\]/);
});
