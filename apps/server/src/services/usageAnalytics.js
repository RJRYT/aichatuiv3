import { ensureBranches, getBranchMessages } from './conversationBranches.js';

export function aggregateUsageFromChats(chats, days = 30, now = Date.now()) {
  const since = new Date(now - (days - 1) * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const byDay = new Map();
  const modelUsage = {};
  const totals = { chats: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, responseMs: 0, assistantDurations: 0, requestsWithUsage: 0, missingUsageMessages: 0, legacyUsageMessages: 0 };
  const bucketFor = (date) => {
    const key = date.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, { date: key, userMessages: 0, assistantMessages: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, responseMs: 0, requestsWithUsage: 0 });
    return byDay.get(key);
  };
  const addAssistantResponse = (message, response, responseDate, bucket) => {
    const hasVersions = Array.isArray(message.versions) && message.versions.length > 0;
    totals.assistantMessages += 1; bucket.assistantMessages += 1;
    const duration = Number(response.durationMs ?? (!hasVersions ? message.durationMs : undefined));
    if (Number.isFinite(duration) && duration > 0) { totals.responseMs += duration; totals.assistantDurations += 1; bucket.responseMs += duration; }
    const usage = response.usage || {};
    const prompt = Number(usage.prompt_tokens), completion = Number(usage.completion_tokens), total = Number(usage.total_tokens);
    const hasUsage = Number.isFinite(total) || Number.isFinite(prompt) || Number.isFinite(completion);
    if (hasUsage) {
      totals.requestsWithUsage += 1; bucket.requestsWithUsage += 1;
      if (Number.isFinite(prompt)) { totals.promptTokens += prompt; bucket.promptTokens += prompt; }
      if (Number.isFinite(completion)) { totals.completionTokens += completion; bucket.completionTokens += completion; }
      const combined = Number.isFinite(total) ? total : (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
      totals.totalTokens += combined; bucket.totalTokens += combined;
      if (!(response.usageByModel || (!Array.isArray(message.versions) && message.usageByModel))) totals.legacyUsageMessages += 1;
    } else totals.missingUsageMessages += 1;
    const modelAlias = response.model?.alias || (!hasVersions ? message.model?.alias : '');
    const responseUsageByModel = response.usageByModel || (!hasVersions ? message.usageByModel : null);
    const byModel = responseUsageByModel || (modelAlias && hasUsage ? { [modelAlias]: usage } : {});
    const responseCallsByModel = response.modelCallsByModel || (!hasVersions ? message.modelCallsByModel : null);
    const callsByModel = responseCallsByModel || (modelAlias ? { [modelAlias]: 1 } : {});
    const modelAliases = new Set([...Object.keys(byModel), ...Object.keys(callsByModel)]);
    for (const alias of modelAliases) {
      if (!modelUsage[alias]) modelUsage[alias] = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const item = modelUsage[alias];
      item.requests += Number(callsByModel[alias]) || 0;
      const values = byModel[alias] || {};
      item.promptTokens += Number(values.prompt_tokens) || 0;
      item.completionTokens += Number(values.completion_tokens) || 0;
      item.totalTokens += Number(values.total_tokens) || (Number(values.prompt_tokens) || 0) + (Number(values.completion_tokens) || 0);
    }
    const events = Array.isArray(response.toolEvents) ? response.toolEvents : (!hasVersions && Array.isArray(message.toolEvents) ? message.toolEvents : []);
    totals.toolCalls += events.length; bucket.toolCalls += events.length;
  };

  for (const chat of chats || []) {
    ensureBranches(chat);
    const uniqueMessages = new Map();
    for (const branch of chat.branches || []) {
      const branchMessages = getBranchMessages(chat, branch.branchId) || [];
      branchMessages.forEach((message, index) => {
        const hasFallbackIdentity = Boolean(message.role || message.createdAt || message.content);
        const fallbackIdentity = `${message.role || ''}:${message.createdAt || ''}:${String(message.content || '').slice(0, 120)}`;
        const key = message.id || (hasFallbackIdentity ? fallbackIdentity : `${branch.branchId}:${index}`);
        if (!uniqueMessages.has(key)) uniqueMessages.set(key, message);
      });
    }
    let chatInRange = false;
    for (const message of uniqueMessages.values()) {
      const messageDate = message.createdAt ? new Date(message.createdAt) : null;
      if (message.role === 'user') {
        if (!messageDate || Number.isNaN(messageDate.getTime()) || messageDate < since) continue;
        chatInRange = true;
        const bucket = bucketFor(messageDate);
        totals.userMessages += 1; bucket.userMessages += 1;
      } else if (message.role === 'assistant') {
        const responses = Array.isArray(message.versions) && message.versions.length ? message.versions : [message];
        for (const response of responses) {
          const responseDate = response.createdAt ? new Date(response.createdAt) : messageDate;
          if (!responseDate || Number.isNaN(responseDate.getTime()) || responseDate < since) continue;
          chatInRange = true;
          addAssistantResponse(message, response, responseDate, bucketFor(responseDate));
        }
      }
    }
    if (chatInRange) totals.chats += 1;
  }
  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { since: since.toISOString(), totals: { ...totals, avgResponseMs: totals.assistantDurations ? Math.round(totals.responseMs / totals.assistantDurations) : 0 }, daily, modelUsage };
}
