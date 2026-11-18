function textContent(content) {
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((part) => part?.type === 'text')
          .map((part) => part.text)
          .join('\n')
      : '';
}

function timestampMilliseconds(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function chatExportFilename(title) {
  const slug = String(title || 'chat')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return `${slug || 'chat'}.json`;
}

export function buildChatExport({
  title = 'New chat',
  createdAt = null,
  updatedAt = null,
  messages = [],
  exportedAt = new Date().toISOString(),
} = {}) {
  const exportTime = timestampMilliseconds(exportedAt);
  const activeAssistant = messages.some(
    (message) => message.role === 'assistant' && message.isStreaming
  );
  const timestamps = [
    createdAt,
    updatedAt,
    ...(activeAssistant ? [exportedAt] : []),
    ...messages.flatMap((message) => [
      message.startedAt,
      message.createdAt,
      message.completedAt,
      ...(message.toolEvents || []).flatMap((event) => [event.startedAt, event.completedAt]),
    ]),
  ]
    .filter((timestamp) => timestamp !== null && timestamp !== undefined && timestamp !== '')
    .map(timestampMilliseconds)
    .filter((timestamp) => timestamp !== null);
  const startedAt = timestamps.length ? Math.min(...timestamps) : null;
  const lastActivityAt = timestamps.length ? Math.max(...timestamps) : null;
  const assistantWorkedMs = messages.reduce((total, message) => {
    if (message.role !== 'assistant') return total;
    const start = timestampMilliseconds(message.startedAt || message.createdAt);
    if (message.isStreaming && start !== null && exportTime !== null)
      return total + Math.max(0, exportTime - start);
    return Number.isFinite(Number(message.durationMs))
      ? total + Math.max(0, Number(message.durationMs))
      : total;
  }, 0);
  const toolWorkedMs = messages.reduce(
    (total, message) =>
      total +
      (message.toolEvents || []).reduce((subtotal, event) => {
        const start = timestampMilliseconds(event.startedAt);
        if (event.status === 'running' && start !== null && exportTime !== null)
          return subtotal + Math.max(0, exportTime - start);
        return Number.isFinite(Number(event.durationMs))
          ? subtotal + Math.max(0, Number(event.durationMs))
          : subtotal;
      }, 0),
    0
  );
  return {
    title,
    createdAt,
    updatedAt,
    exportedAt,
    timing: {
      startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
      lastActivityAt: lastActivityAt === null ? null : new Date(lastActivityAt).toISOString(),
      elapsedMs:
        startedAt === null || lastActivityAt === null
          ? null
          : Math.max(0, lastActivityAt - startedAt),
      assistantWorkedMs,
      toolWorkedMs,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: textContent(message.content),
      createdAt: message.createdAt || null,
      startedAt: message.startedAt || null,
      completedAt: message.completedAt || null,
      durationMs: message.durationMs ?? null,
      toolEvents: message.toolEvents || [],
      agentEvents: message.agentEvents || [],
      agentPlan: message.agentPlan || null,
      versions: message.versions || [],
    })),
  };
}
