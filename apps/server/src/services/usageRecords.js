import mongoose from 'mongoose';
import { UsageRecord } from '../models/UsageRecord.js';
import { ensureBranches, getBranchMessages } from './conversationBranches.js';
const memory = new Map();
function dbReady() { return mongoose.connection.readyState === 1; }
export async function recordUsageEvent({ generationId, ownerId, chatId, message }) {
  if (!generationId || !ownerId || !message) return null;
  const role = message.role === 'user' ? 'user' : 'assistant';
  const messageId = String(message.id || `${role}:${message.createdAt || generationId}`);
  const versionIndex = Math.max(0, Number(message.versionIndex) || 0);
  const record = {
    generationId: String(generationId), ownerId: String(ownerId), chatId: String(chatId || ''),
    messageId, role, versionIndex, occurredAt: new Date(message.completedAt || message.createdAt || Date.now()),
    durationMs: Math.max(0, Number(message.durationMs) || 0), usage: message.usage || {},
    usageByModel: message.usageByModel || {}, modelCallsByModel: message.modelCallsByModel || {},
    model: message.model || {}, toolCalls: Array.isArray(message.toolEvents) ? message.toolEvents.length : 0,
  };
  if (dbReady()) return UsageRecord.findOneAndUpdate(
    { ownerId: record.ownerId, chatId: record.chatId, role, messageId, versionIndex },
    { $setOnInsert: record }, { upsert: true, new: true }
  ).lean();
  const existing = [...memory.values()].find((item) => item.ownerId === record.ownerId && item.chatId === record.chatId && item.role === role && item.messageId === messageId && item.versionIndex === versionIndex);
  if (existing) return existing;
  memory.set(record.generationId, record);
  return record;
}

export async function backfillChatUsage(ownerId, chat) {
  if (!chat?._id) return { recorded: 0 };
  ensureBranches(chat);
  const unique = new Map();
  for (const branch of chat.branches || []) {
    const messages = getBranchMessages(chat, branch.branchId) || [];
    for (const message of messages) {
      if (!message || !['user', 'assistant'].includes(message.role)) continue;
      const messageId = String(message.id || `${message.role}:${message.createdAt || ''}:${String(message.content || '').slice(0,80)}`);
      if (!unique.has(messageId)) unique.set(messageId, message);
    }
  }
  let recorded = 0;
  for (const [messageId, message] of unique) {
    const versions = message.role === 'assistant' && Array.isArray(message.versions) && message.versions.length ? message.versions : [message];
    for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
      const response = { ...versions[versionIndex], id: messageId, role: message.role, versionIndex };
      const generationId = `legacy:${String(chat._id)}:${messageId}:${message.role}:${versionIndex}`;
      await recordUsageEvent({ generationId, ownerId, chatId: String(chat._id), message: response });
      recorded += 1;
    }
  }
  return { recorded };
}

export async function aggregateUsageRecords(ownerId, days = 30, now = Date.now(), excludeChatIds = []) {
  const since = new Date(now - (days - 1) * 86400000); since.setUTCHours(0,0,0,0);
  const excluded = new Set((excludeChatIds || []).map(String));
  const allRecords = dbReady() ? await UsageRecord.find({ ownerId: String(ownerId), occurredAt: { $gte: since } }).sort({ occurredAt: 1 }).lean() : [...memory.values()].filter((r) => r.ownerId === String(ownerId) && new Date(r.occurredAt) >= since);
  const records = allRecords.filter((record) => !excluded.has(String(record.chatId || '')));
  const daily = new Map(); const modelUsage = {}; const totals = { chats: new Set(records.map((r) => r.chatId).filter(Boolean)).size, userMessages: 0, assistantMessages: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, responseMs: 0, assistantDurations: 0, requestsWithUsage: 0, missingUsageMessages: 0, legacyUsageMessages: 0 };
  for (const r of records) {
    const date = new Date(r.occurredAt).toISOString().slice(0,10);
    if (!daily.has(date)) daily.set(date, { date, userMessages: 0, assistantMessages: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, responseMs: 0, requestsWithUsage: 0 });
    const b = daily.get(date);
    if (r.role === 'user') { totals.userMessages++; b.userMessages++; continue; }
    totals.assistantMessages++; b.assistantMessages++;
    totals.toolCalls += Number(r.toolCalls)||0; b.toolCalls += Number(r.toolCalls)||0;
    const d = Number(r.durationMs)||0; if (d>0) { totals.responseMs += d; totals.assistantDurations++; b.responseMs += d; }
    const u = r.usage || {}; const p=Number(u.prompt_tokens), c=Number(u.completion_tokens), t=Number(u.total_tokens); const has = Number.isFinite(p)||Number.isFinite(c)||Number.isFinite(t);
    if (has) { totals.requestsWithUsage++; b.requestsWithUsage++; if(Number.isFinite(p)){totals.promptTokens+=p;b.promptTokens+=p;} if(Number.isFinite(c)){totals.completionTokens+=c;b.completionTokens+=c;} const sum=Number.isFinite(t)?t:(Number.isFinite(p)?p:0)+(Number.isFinite(c)?c:0); totals.totalTokens+=sum;b.totalTokens+=sum; }
    else totals.missingUsageMessages++;
    const byModel = r.usageByModel && Object.keys(r.usageByModel).length ? r.usageByModel : (r.model?.alias && has ? { [r.model.alias]: u } : {});
    const calls = r.modelCallsByModel && Object.keys(r.modelCallsByModel).length ? r.modelCallsByModel : (r.model?.alias ? { [r.model.alias]: 1 } : {});
    for (const alias of new Set([...Object.keys(byModel),...Object.keys(calls)])) { const item=modelUsage[alias] ||= {requests:0,promptTokens:0,completionTokens:0,totalTokens:0}; const v=byModel[alias]||{}; item.requests += Number(calls[alias])||0; item.promptTokens += Number(v.prompt_tokens)||0; item.completionTokens += Number(v.completion_tokens)||0; item.totalTokens += Number(v.total_tokens)||((Number(v.prompt_tokens)||0)+(Number(v.completion_tokens)||0)); }
  }
  return { since: since.toISOString(), totals: { ...totals, avgResponseMs: totals.assistantDurations ? Math.round(totals.responseMs/totals.assistantDurations) : 0 }, daily: [...daily.values()], modelUsage };
}
export function __resetUsageRecordsForTests() { memory.clear(); }
