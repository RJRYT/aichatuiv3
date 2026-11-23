import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../../client/src/App.jsx', import.meta.url), 'utf8');

test('suggested next steps are limited to the latest assistant message', () => {
  assert.match(appSource, /const lastAssistantMessageIndex = messages\.reduce\(/);
  assert.match(appSource, /isLastAssistant=\{index === lastAssistantMessageIndex\}/);
  assert.match(appSource, /!user && isLastAssistant && !message\.isStreaming/);
});

test('refresh recovery preserves the original generation start timestamp', () => {
  assert.match(appSource, /Number\(recovery\.startedAt\) \|\| Date\.parse\(recovery\.assistantStartedAt \|\| ''\)/);
  assert.match(appSource, /Number\(recovery\.startedAt\) \|\| persistedStartedAt \|\| generationStartedAt/);
  assert.match(appSource, /startedAt: stableStartedAt/);
});

test('single-chat cleanup switches are conditional on available resources', () => {
  assert.match(appSource, /Number\(deletePreview\?\.libraryFiles \|\| 0\) > 0/);
  assert.match(appSource, /Number\(deletePreview\?\.sharedSegments \|\| 0\) > 0/);
  assert.match(appSource, /role="switch"/);
  assert.doesNotMatch(appSource, /Also delete generated File Library files[\s\S]{0,180}<input type="checkbox"/);
});
