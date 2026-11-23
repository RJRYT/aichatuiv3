import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ALIAS,
  getModel,
  publicModelCatalog,
} from '../src/services/modelRegistry.js';
import {
  ruleBasedRoute,
  escalationTarget,
  isEscalatableModelError,
} from '../src/services/modelRouter.js';

test('Nemotron aliases map to the selected NVIDIA model IDs', () => {
  assert.equal(MODEL_REGISTRY.bolt.id, 'nvidia/nemotron-3.5-bolt-e4b');
  assert.equal(MODEL_REGISTRY.vision.id, 'nvidia/nemotron-3.5-super-vl-120b-a12b');
  assert.equal(MODEL_REGISTRY.surge.id, 'nvidia/nemotron-3.5-lightning-30b-a3b');
  assert.equal(MODEL_REGISTRY.titan.id, 'nvidia/nemotron-3-ultra-550b-a55b');
  assert.equal(MODEL_REGISTRY.omni.id, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  assert.equal(getModel('invalid').alias, DEFAULT_MODEL_ALIAS);
  assert.equal(MODEL_REGISTRY.bolt.supportsTools, false);
  assert.equal(publicModelCatalog().length, 5);
});

test('hybrid router capability rules select visual, lightweight, and agentic models', () => {
  assert.equal(
    ruleBasedRoute([
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
      },
    ]).alias,
    'vision'
  );
  assert.equal(
    ruleBasedRoute([
      {
        role: 'user',
        content: [{ type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AA==' } }],
      },
    ]).alias,
    'omni'
  );
  assert.equal(ruleBasedRoute([{ role: 'user', content: 'Hi, what is 2 + 2?' }]).alias, 'bolt');
  assert.equal(
    ruleBasedRoute([{ role: 'user', content: 'Create a short poem about rain.' }]).alias,
    'bolt'
  );
  assert.equal(
    ruleBasedRoute([
      { role: 'user', content: 'Build a feature and debug its tests in this repository.' },
    ]).alias,
    'surge'
  );
});

test('controlled escalation only moves lightweight models toward stronger compatible models', () => {
  assert.equal(escalationTarget('bolt'), 'surge');
  assert.equal(escalationTarget('surge'), 'titan');
  assert.equal(escalationTarget('titan'), null);
  assert.equal(isEscalatableModelError({ status: 429 }), true);
  assert.equal(isEscalatableModelError({ status: 401 }), false);
  assert.equal(
    isEscalatableModelError({ status: 400, message: 'maximum context length exceeded' }),
    true
  );
});

test('AI router calls Bolt and accepts only a registered alias', async () => {
  const oldFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                model: 'titan',
                task_type: 'architecture',
                complexity: 'high',
                reason: 'Deep system design',
                confidence: 0.93,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  try {
    const { routeModel } = await import('../src/services/modelRouter.js');
    const result = await routeModel({
      messages: [
        { role: 'user', content: 'Design a distributed system with complex failure recovery.' },
      ],
      apiKey: 'test-key',
    });
    assert.equal(payload.model, MODEL_REGISTRY.bolt.id);
    assert.equal(result.alias, 'titan');
    assert.equal(result.source, 'ai-router');
    assert.equal(result.usage.total_tokens, 60);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('AI router falls back to deterministic capability rules when Bolt routing fails', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  try {
    const { routeModel } = await import('../src/services/modelRouter.js');
    const result = await routeModel({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
        },
      ],
      apiKey: 'test-key',
    });
    assert.equal(result.alias, 'vision');
    assert.equal(result.source, 'capability-rule');
    assert.equal(result.routerCalled, true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('AI router guards tool-requiring requests away from Bolt', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                model: 'bolt',
                task_type: 'simple',
                complexity: 'low',
                reason: 'fast',
                confidence: 0.8,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  try {
    const { routeModel } = await import('../src/services/modelRouter.js');
    const result = await routeModel({
      messages: [
        { role: 'user', content: 'Build a complete MERN application and write the files.' },
      ],
      apiKey: 'test-key',
    });
    assert.equal(result.alias, 'surge');
    assert.equal(result.source, 'capability-guard');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
