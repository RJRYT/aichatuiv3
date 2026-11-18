import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatErrorMessage,
  fetchChatStream,
  readChatEventStream,
  responseError,
} from '../../client/src/chatStream.js';

function streamResponse(chunks, { close = true } = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (close) controller.close();
      },
    }),
    { status: 200 }
  );
}

test('chat event stream parses complete events and requires a terminal event', async () => {
  const response = streamResponse([
    'data: {"type":"heartbeat","message":"Working"}\n\n',
    'data: {"type":"chunk","content":"Hello"}\n\n',
    'data: {"type":"done"}\n\n',
  ]);
  const events = [];
  for await (const event of readChatEventStream(response)) events.push(event);
  assert.deepEqual(
    events.map((event) => event.type),
    ['heartbeat', 'chunk', 'done']
  );
});

test('hidden reasoning traffic times out until a visible event arrives', async () => {
  let interval;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        interval = setInterval(
          () =>
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n'
              )
            ),
          2
        );
      },
      cancel() {
        clearInterval(interval);
      },
    }),
    { status: 200 }
  );
  await assert.rejects(
    async () => {
      for await (const _event of readChatEventStream(response, {
        firstEventTimeoutMs: 30,
        idleTimeoutMs: 100,
        turnTimeoutMs: 500,
      })) {
        // Hidden reasoning is not a user-visible SSE event.
      }
    },
    (error) => {
      assert.equal(error.code, 'CHAT_FIRST_EVENT_TIMEOUT');
      assert.match(error.message, /did not start responding/);
      return true;
    }
  );
});

test('chat event stream reports an incomplete server response', async () => {
  await assert.rejects(
    async () => {
      for await (const _event of readChatEventStream(
        streamResponse(['data: {"type":"chunk","content":"partial"}\n\n'])
      )) {
        continue;
      }
    },
    (error) => {
      assert.equal(error.code, 'CHAT_STREAM_INCOMPLETE');
      return true;
    }
  );
});

test('chat stream surfaces JSON and plain-text HTTP errors', async () => {
  const jsonError = await responseError(
    new Response(JSON.stringify({ error: 'Model service unavailable.' }), { status: 503 })
  );
  assert.equal(jsonError.status, 503);
  assert.equal(jsonError.message, 'Model service unavailable.');

  const textError = await responseError(
    new Response('<html><body>Proxy unavailable</body></html>', { status: 502 })
  );
  assert.equal(textError.status, 502);
  assert.equal(textError.message, 'Proxy unavailable');
});

test('chat stream connection timeout aborts the pending request', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  try {
    await assert.rejects(fetchChatStream('/api/chat/stream', {}, controller, 20), (error) => {
      assert.equal(error.code, 'CHAT_CONNECT_TIMEOUT');
      assert.equal(controller.signal.aborted, true);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat stream converts low-level network failures into actionable messages', () => {
  assert.match(
    chatErrorMessage(new TypeError('Failed to fetch')),
    /connection to the server was interrupted/
  );
  assert.equal(
    chatErrorMessage({ code: 'CHAT_STREAM_IDLE_TIMEOUT' }),
    'The server stopped sending updates. Please retry.'
  );
});
