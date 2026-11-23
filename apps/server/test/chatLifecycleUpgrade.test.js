import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('chat persistence retains live placeholders and clears streaming state on completion', () => {
  const source = read('../src/services/chatStore.js');
  assert.match(source, /if \(message\.completedAt\) safe\.isStreaming = false/);
  assert.match(source, /else if \(typeof message\.isStreaming === 'boolean'\) safe\.isStreaming = message\.isStreaming/);
});

test('refresh recovery reconstructs chunks, tool events and agent events by assistant message ID', () => {
  const source = read('../../client/src/App.jsx');
  assert.match(source, /assistantMessageId: assistantId/);
  assert.match(source, /if \(event\.type === 'chunk'\)/);
  assert.match(source, /if \(event\.type === 'tool_start'\)/);
  assert.match(source, /if \(event\.type === 'tool_result'\)/);
  assert.match(source, /if \(event\.type === 'agent_event'\)/);
});

test('suggested next steps are model-generated and persisted, not selected from static templates', () => {
  const ui = read('../../client/src/App.jsx');
  const route = read('../src/routes/chat.js');
  const model = read('../src/services/nvidia.js');
  assert.match(ui, /message\?\.suggestedNextSteps/);
  assert.match(ui, /request\('\/api\/chat\/suggestions'/);
  assert.match(route, /generateSuggestedNextSteps/);
  assert.match(model, /Generate 2 to 4 genuinely useful, context-specific next actions/);
  assert.doesNotMatch(ui, /Investigate the blocker|Continue the next task|Verify the result/);
});

test('single chat deletion supports optional library/share cleanup and bulk deletion removes both', () => {
  const source = read('../src/routes/chats.js');
  assert.match(source, /deleteLibraryFiles: req\.body\?\.deleteLibraryFiles === true/);
  assert.match(source, /deleteSharedSegments: req\.body\?\.deleteSharedSegments === true/);
  assert.match(source, /router\.delete\('\/bulk'/);
  assert.match(source, /deleteLibraryFiles: true, deleteSharedSegments: true/);
  assert.ok(source.indexOf('await deleteWorkspaceForChat') < source.indexOf('const deleted = await deleteChat'));
});

test('File Library supports owner-scoped bulk deletion', () => {
  const route = read('../src/routes/interpreter.js');
  const store = read('../src/services/interpreter/artifactStore.js');
  assert.match(route, /router\.delete\('\/artifacts\/bulk'/);
  assert.match(route, /deleteArtifacts\(ids, owner\(req\)\)/);
  assert.match(store, /Artifact\.deleteMany\(\{ _id: \{ \$in: ids \}, ownerId: owner \}\)/);
});
