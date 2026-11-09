import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPlan, updatePlannedTask } from '../src/services/agentPlanning.js';
import {
  generateImageArtifact,
  getImageGenerationStatus,
} from '../src/services/imageGeneration.js';
import { getArtifact } from '../src/services/interpreter/artifactStore.js';

test('task planner validates dependencies and emits plan/task events', () => {
  const agentState = {};
  const emitted = [];
  const onAgentEvent = (type, data) => emitted.push({ type, data });
  const created = createTaskPlan(
    {
      objective: 'Research and create a report',
      tasks: [
        { id: 'research', title: 'Research sources' },
        { id: 'report', title: 'Create report', depends_on: ['research'] },
      ],
    },
    agentState,
    onAgentEvent
  );
  assert.equal(created.plan.tasks.length, 2);
  assert.equal(emitted[0].type, 'plan_created');
  assert.throws(
    () => updatePlannedTask({ task_id: 'report', status: 'running' }, agentState),
    /blocked/
  );
  updatePlannedTask({ task_id: 'research', status: 'running' }, agentState, onAgentEvent);
  updatePlannedTask(
    { task_id: 'research', status: 'completed', note: 'Sources verified' },
    agentState,
    onAgentEvent
  );
  updatePlannedTask({ task_id: 'report', status: 'running' }, agentState, onAgentEvent);
  updatePlannedTask({ task_id: 'report', status: 'completed' }, agentState, onAgentEvent);
  assert.equal(
    agentState.plan.tasks.every((task) => task.status === 'completed'),
    true
  );
  assert.ok(emitted.some((item) => item.type === 'task_updated'));
});

test('task planner rejects dependency cycles and duplicate task IDs', () => {
  assert.throws(
    () =>
      createTaskPlan(
        {
          objective: 'Cycle',
          tasks: [
            { id: 'a', title: 'A', depends_on: ['b'] },
            { id: 'b', title: 'B', depends_on: ['a'] },
          ],
        },
        {}
      ),
    /cycle/
  );
  assert.throws(
    () =>
      createTaskPlan(
        {
          objective: 'Duplicates',
          tasks: [
            { id: 'a', title: 'A' },
            { id: 'a', title: 'Duplicate' },
          ],
        },
        {}
      ),
    /duplicate/
  );
});

test('Cloudflare FLUX image generation stores verified image bytes as an artifact', async () => {
  const oldFetch = globalThis.fetch;
  const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const oldToken = process.env.CLOUDFLARE_API_TOKEN;
  const oldMongo = process.env.MONGODB_URI;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  delete process.env.MONGODB_URI;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  let requestUrl = '';
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const body = JSON.parse(options.body);
    assert.equal(body.prompt, 'A small red lighthouse on a rocky coast');
    assert.equal(body.steps, 4);
    return new Response(JSON.stringify({ success: true, result: { image: jpeg } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    assert.equal(getImageGenerationStatus().configured, true);
    const result = await generateImageArtifact(
      { prompt: 'A small red lighthouse on a rocky coast' },
      { _id: 'v7-agent-test-user' },
      { chatId: 'v7-test-chat' }
    );
    assert.equal(result.status, 'completed');
    assert.equal(result.artifacts.length, 1);
    assert.match(requestUrl, /@cf\/black-forest-labs\/flux-1-schnell$/);
    const metadata = result.artifacts[0];
    const stored = await getArtifact(metadata.id, 'v7-agent-test-user');
    assert.equal(stored.data.byteLength, 4);
    assert.equal(stored.mimeType, 'image/jpeg');
    assert.equal(stored.sha256.length, 64);
    assert.equal(
      'downloadUrl' in metadata,
      false,
      'internal artifact URLs must not be passed back to the model'
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = oldAccount;
    if (oldToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = oldToken;
    if (oldMongo === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = oldMongo;
  }
});
