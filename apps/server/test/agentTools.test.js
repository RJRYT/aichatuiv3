import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPlan, updatePlannedTask } from '../src/services/agentPlanning.js';
import {
  generateImageArtifact,
  getImageGenerationStatus,
} from '../src/services/imageGeneration.js';
import {
  deleteArtifacts,
  getArtifact,
  storeArtifact,
} from '../src/services/interpreter/artifactStore.js';
import { readFile } from 'node:fs/promises';
import { getToolDefinitions, getPluginCatalog, isPluginEnabled, isToolUserConfigurable, runTool } from '../src/services/tools.js';
import { Share } from '../src/models/Share.js';

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

test('saving an edited artifact preserves the previous version and adds a numeric filename suffix', async () => {
  const previousMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  const ownerId = 'artifact-version-test-user';
  const savedIds = [];
  try {
    const first = await storeArtifact({
      ownerId,
      chatId: 'version-chat',
      executionId: 'version-1',
      name: 'App.jsx',
      relativePath: 'src/App.jsx',
      content: 'first version',
    });
    savedIds.push(first.id);
    const second = await storeArtifact({
      ownerId,
      chatId: 'version-chat',
      executionId: 'version-2',
      name: 'App.jsx',
      relativePath: 'src/App.jsx',
      content: 'second version',
    });
    savedIds.push(second.id);
    const third = await storeArtifact({
      ownerId,
      chatId: 'another-chat',
      executionId: 'version-3',
      name: 'App.jsx',
      relativePath: 'src/App.jsx',
      content: 'third version',
    });
    savedIds.push(third.id);

    assert.deepEqual([first.name, second.name, third.name], ['App.jsx', 'App-1.jsx', 'App-2.jsx']);
    assert.deepEqual(
      [first.relativePath, second.relativePath, third.relativePath],
      ['src/App.jsx', 'src/App-1.jsx', 'src/App-2.jsx']
    );
    assert.equal((await getArtifact(first.id, ownerId)).data.toString(), 'first version');
    assert.equal((await getArtifact(second.id, ownerId)).data.toString(), 'second version');
  } finally {
    await deleteArtifacts(savedIds, ownerId);
    if (previousMongo === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousMongo;
  }
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

test('progress reporting is a dedicated user-facing tool and excludes private reasoning', async () => {
  const source = await readFile(new URL('../src/services/tools.js', import.meta.url), 'utf8');
  assert.match(source, /name: 'report_progress'/);
  assert.match(source, /one natural sentence in first person/i);
  assert.match(source, /private chain-of-thought/i);
  assert.match(source, /maxLength: 280/);
});

test('account-history tools require sign-in and have explicit-request descriptions', async () => {
  const definitions = getToolDefinitions();
  const names = definitions.map((tool) => tool.function.name);
  assert.ok(names.includes('list_shared_links'));
  assert.ok(names.includes('search_previous_chats'));
  assert.match(
    definitions.find((tool) => tool.function.name === 'search_previous_chats').function.description,
    /only when the user explicitly asks/i
  );
  assert.equal((await runTool('list_shared_links', {}, { _id: 'guest:test' })).ok, false);
  assert.equal(
    (await runTool('search_previous_chats', { query: 'earlier' }, { _id: 'guest:test' })).ok,
    false
  );
});


test('native workspace tools are available without enabling Python execution', () => {
  const definitions = getToolDefinitions();
  const names = definitions.map((tool) => tool.function.name);
  for (const name of ['workspace_list', 'workspace_read', 'workspace_create', 'workspace_edit', 'workspace_delete', 'workspace_search', 'workspace_status', 'workspace_archive']) {
    assert.ok(names.includes(name), `expected ${name} to be registered`);
  }
  const nodeRuntimeConfigured = Boolean(process.env.VERCEL_NODE_SANDBOX_IMAGE && ((process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID) || process.env.VERCEL_OIDC_TOKEN || (process.env.VERCEL === '1' && process.env.VERCEL_ENV)));
  assert.equal(names.includes('execute_node'), nodeRuntimeConfigured);
  assert.match(definitions.find((tool) => tool.function.name === 'execute_python').function.description, /do not start Python merely to write files/i);
});

test('shared-link lookup returns only the signed-in user’s active shares', async () => {
  const originalFind = Share.find;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  let filter;
  process.env.FRONTEND_URL = 'https://example.test/';
  Share.find = (query) => {
    filter = query;
    return {
      select() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => [
        {
          shareId: 'public-share-id',
          title: 'Project notes',
          shareType: 'chat',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    };
  };
  try {
    const outcome = await runTool('list_shared_links', {}, { _id: 'user-123' });
    assert.equal(outcome.ok, true);
    assert.deepEqual(filter, { ownerId: 'user-123', revokedAt: null });
    assert.equal(outcome.result.shares[0].url, 'https://example.test/share/public-share-id');
    assert.equal('chatId' in outcome.result.shares[0], false);
  } finally {
    Share.find = originalFind;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  }
});


test('only high-impact tools expose permission switches; low-risk tools stay enabled', () => {
  assert.equal(isToolUserConfigurable('execute_python'), true);
  assert.equal(isToolUserConfigurable('workspace_delete'), true);
  assert.equal(isToolUserConfigurable('github_search'), false);
  assert.equal(isToolUserConfigurable('npm_search'), false);
  assert.equal(isPluginEnabled({ pluginPermissions: { github_search: false } }, 'github_search'), true);
  assert.equal(isPluginEnabled({ pluginPermissions: { execute_python: false } }, 'execute_python'), false);
  const catalog = getPluginCatalog();
  assert.equal(catalog.find((item) => item.id === 'github_search').configurable, false);
  assert.equal(catalog.find((item) => item.id === 'github_search').defaultEnabled, true);
});
