const TERMINAL_EVENT_TYPES = new Set(['done', 'error', 'stopped']);

export class ChatStreamError extends Error {
  constructor(message, { code = 'CHAT_STREAM_ERROR', status } = {}) {
    super(message);
    this.name = 'ChatStreamError';
    this.code = code;
    this.status = status;
  }
}

export function chatErrorMessage(error, fallback = 'The server could not complete the request.') {
  if (error?.name === 'AbortError') return 'Generation stopped.';
  if (error?.code === 'CHAT_STREAM_IDLE_TIMEOUT')
    return 'The server stopped sending updates. Please retry.';
  if (error?.code === 'CHAT_CONNECT_TIMEOUT')
    return 'The server did not start the response in time. Check your connection and retry.';
  if (error?.code === 'CHAT_STREAM_INCOMPLETE')
    return 'The server closed the response before finishing. Please retry.';
  if (error instanceof TypeError)
    return 'The connection to the server was interrupted. Check your connection and retry.';
  return String(error?.message || fallback);
}

export async function fetchChatStream(url, options, controller, timeoutMs = 110_000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new ChatStreamError(
        'The server did not start the response in time. Check your connection and retry.',
        { code: 'CHAT_CONNECT_TIMEOUT' }
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetch(url, { ...options, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function* readChatEventStream(
  response,
  { idleTimeoutMs = 100_000, turnTimeoutMs = 16 * 60_000, now = Date.now, signal } = {}
) {
  if (!response?.body?.getReader)
    throw new ChatStreamError('The server returned an empty response stream.', {
      code: 'CHAT_STREAM_EMPTY',
    });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const startedAt = now();
  let lastDataAt = startedAt;
  let isTerminal = false;
  let buffer = '';

  const parseBlock = (block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      throw new ChatStreamError('The server sent an unreadable response event.', {
        code: 'CHAT_STREAM_INVALID_EVENT',
      });
    }
  };

  let onAbort;
  try {
    while (true) {
      const currentTime = now();
      const elapsedMs = currentTime - startedAt;
      const idleRemainingMs = idleTimeoutMs - (currentTime - lastDataAt);
      const turnRemainingMs = turnTimeoutMs - elapsedMs;
      const timeoutMs = Math.min(idleRemainingMs, turnRemainingMs);
      if (timeoutMs <= 0) {
        const code = turnRemainingMs <= 0 ? 'CHAT_STREAM_TURN_TIMEOUT' : 'CHAT_STREAM_IDLE_TIMEOUT';
        const message =
          code === 'CHAT_STREAM_TURN_TIMEOUT'
            ? 'The response exceeded the client time limit. Please retry.'
            : 'The server stopped sending updates. Please retry.';
        throw new ChatStreamError(message, { code });
      }

      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const code =
            turnRemainingMs <= idleRemainingMs
              ? 'CHAT_STREAM_TURN_TIMEOUT'
              : 'CHAT_STREAM_IDLE_TIMEOUT';
          const message =
            code === 'CHAT_STREAM_TURN_TIMEOUT'
              ? 'The response exceeded the client time limit. Please retry.'
              : 'The server stopped sending updates. Please retry.';
          reject(new ChatStreamError(message, { code }));
        }, timeoutMs);
      });
      let result;
      try {
        const reads = [reader.read(), timeout];
        if (signal) {
          if (signal.aborted)
            throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
          const aborted = new Promise((_, reject) => {
            onAbort = () =>
              reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
          });
          reads.push(aborted);
        }
        result = await Promise.race(reads);
      } finally {
        clearTimeout(timeoutId);
        if (onAbort) signal.removeEventListener('abort', onAbort);
        onAbort = undefined;
      }
      if (result.value?.byteLength) lastDataAt = now();
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = parseBlock(block);
        if (!event) continue;
        if (TERMINAL_EVENT_TYPES.has(event.type)) isTerminal = true;
        yield event;
      }
      if (result.done) {
        if (buffer.trim()) {
          const event = parseBlock(buffer);
          if (event) {
            if (TERMINAL_EVENT_TYPES.has(event.type)) isTerminal = true;
            yield event;
          }
        }
        if (!isTerminal)
          throw new ChatStreamError(
            'The server closed the response before finishing the request.',
            {
              code: 'CHAT_STREAM_INCOMPLETE',
            }
          );
        return;
      }
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {}
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export async function responseError(
  response,
  fallback = 'The server could not complete the request.'
) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  let message = '';
  if (body) {
    try {
      const parsed = JSON.parse(body);
      message = typeof parsed.error === 'string' ? parsed.error : '';
    } catch {
      message = body
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
    }
  }
  return new ChatStreamError(message || `${fallback} (HTTP ${response.status})`, {
    code: 'CHAT_HTTP_ERROR',
    status: response.status,
  });
}
