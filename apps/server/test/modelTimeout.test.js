import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRound } from '../src/services/nvidia.js';

test('model request idle timeout aborts silent requests and reports a useful error', async () => {
  const originalFetch = globalThis.fetch;
  const emitted = [];
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  try {
    await assert.rejects(
      requestRound({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        thinkingEnabled: true,
        signal: new AbortController().signal,
        res: { writableEnded: false, write: (event) => emitted.push(event) },
        round: 0,
        hasVision: false,
        idleTimeoutMs: 25,
        roundTimeoutMs: 1000,
        heartbeatIntervalMs: 5,
      }),
      (error) => {
        assert.equal(error.code, 'MODEL_STREAM_IDLE_TIMEOUT');
        assert.match(error.message, /did not send a response/);
        return true;
      }
    );
    assert.ok(
      emitted.some((event) => event.includes('"type":"heartbeat"')),
      'the client should receive a working heartbeat while a model request is pending'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('model stream activity resets the idle timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Ready"},"finish_reason":null}]}\n\n'
            )
          );
        }, 12);
        setTimeout(() => controller.close(), 12);
      },
    });
    return new Response(body, { status: 200 });
  };
  try {
    const result = await requestRound({
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [],
      thinkingEnabled: false,
      signal: new AbortController().signal,
      res: { writableEnded: false, write() {} },
      round: 0,
      hasVision: false,
      idleTimeoutMs: 20,
      roundTimeoutMs: 1000,
      heartbeatIntervalMs: 1000,
    });
    assert.equal(result.content, 'Ready');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('model hidden reasoning cannot keep the client waiting without visible output', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => {
    const body = new ReadableStream({
      start(controller) {
        const emitReasoning = () =>
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"reasoning_content":"still reasoning"},"finish_reason":null}]}\n\n'
            )
          );
        const timer = setInterval(emitReasoning, 5);
        signal.addEventListener(
          'abort',
          () => {
            clearInterval(timer);
            controller.error(signal.reason);
          },
          { once: true }
        );
        emitReasoning();
      },
    });
    return new Response(body, { status: 200 });
  };
  try {
    await assert.rejects(
      requestRound({
        messages: [{ role: 'user', content: 'Build something' }],
        tools: [],
        thinkingEnabled: true,
        signal: new AbortController().signal,
        res: { writableEnded: false, write() {} },
        round: 0,
        hasVision: false,
        idleTimeoutMs: 100,
        firstVisibleOutputTimeoutMs: 30,
        roundTimeoutMs: 1000,
        heartbeatIntervalMs: 1000,
      }),
      (error) => {
        assert.equal(error.code, 'MODEL_FIRST_VISIBLE_OUTPUT_TIMEOUT');
        assert.match(error.message, /did not produce any visible response/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
