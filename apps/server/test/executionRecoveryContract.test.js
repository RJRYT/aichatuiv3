import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, path), 'utf8');

test('agent turn deadline is configurable and requests soft finalization', () => {
  const source = read('../src/services/nvidia.js');
  assert.match(source, /AGENT_CHAT_TURN_TIMEOUT_MS/);
  assert.match(source, /60 \* 60_000/);
  assert.match(source, /activeGeneration\.stopRequest = \{ reason: 'time_limit'/);
  assert.doesNotMatch(source, /This chat turn exceeded its 15-minute time limit/);
});

test('user Stop requests graceful completion rather than aborting the generation controller', () => {
  const source = read('../src/services/nvidia.js');
  const client = read('../../client/src/App.jsx');
  const route = read('../src/routes/chat.js');
  assert.match(source, /export function requestStopChatGeneration/);
  assert.match(source, /summarizeStoppedRun/);
  assert.match(route, /requestStopChatGeneration\(generationId, ownerId, 'user'\)/);
  const stopHandler = client.match(/title="Finish current operation and summarize progress"[\s\S]{0,1000}?onClick=\{\(\) => \{([\s\S]{0,1000}?)\}\}/);
  assert.ok(stopHandler, 'stop button handler should exist');
  assert.doesNotMatch(stopHandler[1], /abortRef\.current\?\.abort\(\)/);
});

test('execution errors return a persisted progress report and completion event', () => {
  const source = read('../src/services/nvidia.js');
  assert.match(source, /Execution status: stopped with an error/);
  assert.match(source, /Recorded progress/);
  assert.match(source, /type: 'final_content'/);
  assert.match(source, /type: 'done', durationMs/);
});

test('multi-file projects are packaged as one archive instead of individual artifacts', () => {
  const prompt = read('../prompts/system-prompt.md');
  assert.match(prompt, /multi-file software project/);
  assert.match(prompt, /do NOT export source files one by one/i);
  assert.match(prompt, /one ZIP/);
});

test('failed messages expose retry and continue-from-checkpoint actions', () => {
  const client = read('../../client/src/App.jsx');
  assert.match(client, /Retry task/);
  assert.match(client, /Continue from saved progress/);
});
