const ACTION = /\b(build|create|develop|generate|make|get|download|fetch|export|package|zip|convert|save|produce|write|give|send|attach|provide)\b/i;
const DELIVERABLE = /\b(file|files|zip|archive|image|photo|logo|website|web\s?app|application|project|report|document|pdf|spreadsheet|excel|csv|json|html|code|script|presentation|pptx|docx)\b/i;
const COMPLEX = /\b(website|web\s?app|application|project|dashboard|platform|system|task\s?manager|management\s?system|production[- ]ready|full[- ]featured)\b/i;

export function classifyUserRequest(messages = []) {
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user');
  const text = typeof lastUser?.content === 'string'
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? lastUser.content.filter((part) => part?.type === 'text').map((part) => part.text).join(' ')
      : '';
  const capabilityQuestion = /^(can you|could you|are you able to|is it possible)/i.test(text.trim()) && !/https?:\/\//i.test(text);
  const hasAction = ACTION.test(text);
  const deliverable = !capabilityQuestion && hasAction && DELIVERABLE.test(text);
  const complex = deliverable && COMPLEX.test(text) && (text.length > 45 || /\b(zip|production[- ]ready|complete|full[- ]featured)\b/i.test(text));
  const wantsZip = /\b(zip|zipped|zip\s?it|archive)\b/i.test(text);
  return { text, deliverable, complex, wantsZip };
}

export function collectVerifiedArtifacts(toolEvents = []) {
  const found = new Map();
  for (const event of toolEvents) {
    for (const item of event?.result?.artifacts || []) {
      if (!item || typeof item.id !== 'string' || !item.id ||
          typeof item.name !== 'string' || !item.name ||
          !Number.isFinite(Number(item.size)) || Number(item.size) <= 0 ||
          !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) continue;
      found.set(item.id, {
        id: item.id,
        name: item.name,
        size: Number(item.size),
        mimeType: String(item.mimeType || 'application/octet-stream'),
        sha256: String(item.sha256),
      });
    }
  }
  return [...found.values()];
}

export function sanitizeAssistantText(text) {
  return String(text || '')
    .replace(/\bhttps?:\/\/[^\s)]+\/api\/(?:interpreter\/artifacts|artifacts)\/[^\s)]+/gi, '[download available in the File Library]')
    .replace(/\/api\/(?:interpreter\/)?artifacts\/[a-zA-Z0-9_-]+/g, '[download available in the File Library]')
    .trim();
}

export function stripArtifactUrlsFromToolEvents(events = []) {
  return events.map((event) => {
    if (!event || typeof event !== 'object') return event;
    const safeEvent = { ...event };
    if (safeEvent.result && typeof safeEvent.result === 'object') {
      safeEvent.result = { ...safeEvent.result };
      if (Array.isArray(safeEvent.result.artifacts)) safeEvent.result.artifacts = safeEvent.result.artifacts.map((artifact) => {
        if (!artifact || typeof artifact !== 'object') return artifact;
        const { downloadUrl, ...safeArtifact } = artifact;
        return safeArtifact;
      });
    }
    return safeEvent;
  });
}

function stripPrivateMessageFields(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== 'object') return message;
    const { reasoning, ...safe } = message;
    if (safe.role === 'assistant' && typeof safe.content === 'string') safe.content = sanitizeAssistantText(safe.content);
    if (Array.isArray(safe.toolEvents)) safe.toolEvents = stripArtifactUrlsFromToolEvents(safe.toolEvents);
    if (Array.isArray(safe.versions)) safe.versions = safe.versions.map((version) => {
      if (!version || typeof version !== 'object') return version;
      const { reasoning: _reasoning, ...safeVersion } = version;
      if (Array.isArray(safeVersion.toolEvents)) safeVersion.toolEvents = stripArtifactUrlsFromToolEvents(safeVersion.toolEvents);
      return safeVersion;
    });
    return safe;
  });
}

export function sanitizeChatForRead(chat) {
  if (!chat) return chat;
  const safe = { ...chat, messages: stripPrivateMessageFields(chat.messages) };
  if (Array.isArray(chat.branches)) safe.branches = chat.branches.map((branch) => ({ ...branch, messages: stripPrivateMessageFields(branch.messages) }));
  return safe;
}
