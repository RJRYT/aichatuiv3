import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { AgentRun } from '../../models/AgentRun.js';

const memoryRuns = new Map();

function databaseReady() {
  if (!process.env.MONGODB_URI) return false;
  if (mongoose.connection.readyState !== 1) throw Object.assign(new Error('MongoDB is temporarily unavailable; agent checkpoints cannot be persisted.'), { status: 503 });
  return true;
}

function publicRun(run) {
  if (!run) return null;
  return {
    runId: String(run.runId), chatId: String(run.chatId), status: run.status,
    round: Number(run.round || 0), executionToolCalls: Number(run.executionToolCalls || 0),
    plan: run.plan || null, completedOperations: Array.isArray(run.completedOperations) ? run.completedOperations.slice(-100) : [],
    lastError: String(run.lastError || ''), startedAt: run.startedAt, updatedAt: run.updatedAt, completedAt: run.completedAt || null,
  };
}

export async function createAgentCheckpoint({ ownerId, chatId, plan = null }) {
  const run = { runId: randomUUID(), ownerId: String(ownerId), chatId: String(chatId), status: 'running', round: 0, executionToolCalls: 0, plan, completedOperations: [], lastError: '', startedAt: new Date(), updatedAt: new Date(), completedAt: null };
  if (databaseReady()) await AgentRun.create(run);
  else memoryRuns.set(run.runId, run);
  return publicRun(run);
}

export async function updateAgentCheckpoint(ownerId, runId, patch = {}) {
  const safePatch = {
    ...(Number.isInteger(patch.round) ? { round: Math.max(0, patch.round) } : {}),
    ...(Number.isInteger(patch.executionToolCalls) ? { executionToolCalls: Math.max(0, patch.executionToolCalls) } : {}),
    ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
    ...(patch.lastError !== undefined ? { lastError: String(patch.lastError).slice(0, 2000) } : {}),
    updatedAt: new Date(),
  };
  if (patch.operation) safePatch.$push = { completedOperations: { $each: [{ ...patch.operation, at: new Date().toISOString() }], $slice: -100 } };
  if (databaseReady()) {
    const update = { $set: safePatch };
    if (safePatch.$push) { update.$push = safePatch.$push; delete safePatch.$push; }
    const run = await AgentRun.findOneAndUpdate({ runId: String(runId), ownerId: String(ownerId) }, update, { new: true }).lean();
    return publicRun(run);
  }
  const run = memoryRuns.get(String(runId));
  if (!run || run.ownerId !== String(ownerId)) return null;
  const operation = safePatch.$push?.completedOperations?.$each?.[0];
  delete safePatch.$push;
  Object.assign(run, safePatch);
  if (operation) run.completedOperations = [...(run.completedOperations || []), operation].slice(-100);
  return publicRun(run);
}

export async function finishAgentCheckpoint(ownerId, runId, status = 'completed', lastError = '') {
  const finalStatus = ['completed', 'interrupted', 'failed'].includes(status) ? status : 'failed';
  const patch = { status: finalStatus, lastError: String(lastError || '').slice(0, 2000), updatedAt: new Date(), completedAt: new Date() };
  if (databaseReady()) {
    const run = await AgentRun.findOneAndUpdate({ runId: String(runId), ownerId: String(ownerId) }, { $set: patch }, { new: true }).lean();
    return publicRun(run);
  }
  const run = memoryRuns.get(String(runId));
  if (!run || run.ownerId !== String(ownerId)) return null;
  Object.assign(run, patch);
  return publicRun(run);
}

export async function getLatestAgentCheckpoint(ownerId, chatId) {
  if (databaseReady()) {
    const run = await AgentRun.findOne({ ownerId: String(ownerId), chatId: String(chatId) }).sort({ startedAt: -1 }).lean();
    return publicRun(run);
  }
  const runs = [...memoryRuns.values()].filter((run) => run.ownerId === String(ownerId) && run.chatId === String(chatId)).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return publicRun(runs[0]);
}


export async function deleteAgentCheckpointsForChat(ownerId, chatId) {
  if (!ownerId || !chatId) return { deletedCount: 0 };
  if (databaseReady()) {
    const result = await AgentRun.deleteMany({ ownerId: String(ownerId), chatId: String(chatId) });
    return { deletedCount: Number(result.deletedCount || 0) };
  }
  let deletedCount = 0;
  for (const [runId, run] of memoryRuns.entries()) {
    if (run.ownerId === String(ownerId) && run.chatId === String(chatId)) { memoryRuns.delete(runId); deletedCount++; }
  }
  return { deletedCount };
}

export function __resetAgentCheckpointMemoryForTests() { memoryRuns.clear(); }
