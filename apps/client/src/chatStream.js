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
  initialResponse,
  { idleTimeoutMs = 0, turnTimeoutMs = 20 * 60_000, now = Date.now, signal, reconnect, maxReconnects = 20 } = {}
) {
  if (!initialResponse?.body?.getReader)
    throw new ChatStreamError('The server returned an empty response stream.', { code: 'CHAT_STREAM_EMPTY' });

  const startedAt = now();
  const decoder = new TextDecoder();
  const seen = new Set();
  let response = initialResponse;
  let lastEventId = 0;
  let reconnects = 0;
  let terminal = false;
  let buffer = '';

  const parseBlock = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return null;
    try { return JSON.parse(data); }
    catch { throw new ChatStreamError('The server sent an unreadable response event.', { code: 'CHAT_STREAM_INVALID_EVENT' }); }
  };

  while (!terminal) {
    if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
    if (now() - startedAt >= turnTimeoutMs) throw new ChatStreamError('The response exceeded the client time limit. The generation may still be running; reconnect to recover its events.', { code: 'CHAT_STREAM_TURN_TIMEOUT' });
    const reader = response.body.getReader();
    let disconnected = false;
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
        const remaining = Math.max(1, turnTimeoutMs - (now() - startedAt));
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new ChatStreamError('The response exceeded the client time limit. The generation may still be running; reconnect to recover its events.', { code: 'CHAT_STREAM_TURN_TIMEOUT' })), remaining); });
        let result;
        try { result = await Promise.race([reader.read(), timeout]); }
        finally { clearTimeout(timer); }
        buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const event = parseBlock(block);
          if (!event) continue;
          const id = Number(event.eventId || 0);
          if (id && seen.has(id)) continue;
          if (id) { seen.add(id); lastEventId = Math.max(lastEventId, id); }
          if (TERMINAL_EVENT_TYPES.has(event.type)) terminal = true;
          yield event;
        }
        if (result.done) {
          if (buffer.trim()) {
            const event = parseBlock(buffer);
            if (event) {
              const id = Number(event.eventId || 0);
              if (!id || !seen.has(id)) {
                if (id) { seen.add(id); lastEventId = Math.max(lastEventId, id); }
                if (TERMINAL_EVENT_TYPES.has(event.type)) terminal = true;
                yield event;
              }
            }
          }
          if (!terminal) disconnected = true;
          break;
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      disconnected = true;
    } finally {
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
    }
    if (terminal) return;
    if (!disconnected) continue;
    if (typeof reconnect !== 'function') {
      throw new ChatStreamError('The server closed the response before finishing the request.', { code: 'CHAT_STREAM_INCOMPLETE' });
    }
    if (reconnects >= maxReconnects) {
      throw new ChatStreamError('The connection was interrupted. The generation may still be running; reopen this chat to recover persisted events.', { code: 'CHAT_STREAM_DISCONNECTED' });
    }
    reconnects += 1;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(1000 + reconnects * 500, 5000));
      if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError')); }, { once: true });
    });
    const next = await reconnect(lastEventId);
    if (!next?.ok || !next.body?.getReader) throw new ChatStreamError('Could not reconnect to the active generation session.', { code: 'CHAT_STREAM_RECONNECT_FAILED' });
    response = next;
    buffer = '';
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
