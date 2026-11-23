import mongoose from 'mongoose';
import { GenerationSession } from '../models/GenerationSession.js';

const memory = new Map();
function databaseReady() {
  if (!process.env.MONGODB_URI) return false;
  if (mongoose.connection.readyState !== 1) throw Object.assign(new Error('Generation persistence is temporarily unavailable.'), { status: 503 });
  return true;
}
export async function createGenerationSession({ generationId, ownerId, chatId }) {
  const record = { generationId: String(generationId), ownerId: String(ownerId), chatId: String(chatId), status: 'running', nextEventId: 1, events: [], startedAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) };
  if (databaseReady()) await GenerationSession.create(record); else memory.set(record.generationId, record);
  return record;
}
export async function appendGenerationEvent(generationId, ownerId, event) {
  const id = String(generationId);
  if (databaseReady()) {
    const session = await GenerationSession.findOneAndUpdate({ generationId: id, ownerId: String(ownerId), status: 'running' }, { $inc: { nextEventId: 1 }, $push: { events: { $each: [event], $slice: -5000 } }, $set: { updatedAt: new Date() } }, { new: true }).lean();
    return session;
  }
  const session = memory.get(id);
  if (!session || session.ownerId !== String(ownerId) || session.status !== 'running') return null;
  session.events.push(event); if (session.events.length > 5000) session.events.splice(0, session.events.length - 5000);
  session.nextEventId += 1; session.updatedAt = new Date(); return session;
}
export async function finishGenerationSession(generationId, ownerId, status, error = '') {
  const patch = { status: ['completed','completed_with_errors','failed','interrupted','cancelled'].includes(status) ? status : 'failed', lastError: String(error || '').slice(0, 2000), updatedAt: new Date(), completedAt: new Date() };
  if (databaseReady()) return GenerationSession.findOneAndUpdate({ generationId: String(generationId), ownerId: String(ownerId) }, { $set: patch }, { new: true }).lean();
  const session = memory.get(String(generationId)); if (!session || session.ownerId !== String(ownerId)) return null; Object.assign(session, patch); return session;
}
export async function getGenerationSession(generationId, ownerId) {
  if (databaseReady()) return GenerationSession.findOne({ generationId: String(generationId), ownerId: String(ownerId) }).lean();
  const session = memory.get(String(generationId)); return session && session.ownerId === String(ownerId) ? session : null;
}
async function interruptStaleSession(session, ownerId, message, staleBefore) {
  const event = { type: 'error', status: 503, error: message, eventId: Number(session.nextEventId || 1), generationId: String(session.generationId), recovered: true };
  const patch = { status: 'interrupted', lastError: message, updatedAt: new Date(), completedAt: new Date() };
  if (databaseReady()) {
    return GenerationSession.findOneAndUpdate({ generationId: String(session.generationId), ownerId: String(ownerId), status: 'running', nextEventId: Number(session.nextEventId || 1), updatedAt: { $lt: staleBefore } }, { $set: patch, $inc: { nextEventId: 1 }, $push: { events: { $each: [event], $slice: -5000 } } }, { new: true }).lean();
  }
  const current = memory.get(String(session.generationId));
  if (!current || current.ownerId !== String(ownerId) || current.status !== 'running' || current.nextEventId !== session.nextEventId || new Date(current.updatedAt).getTime() >= staleBefore.getTime()) return null;
  current.events.push(event); current.nextEventId += 1; Object.assign(current, patch); return current;
}

export async function getGenerationEvents(generationId, ownerId, after = 0) {
  let session = await getGenerationSession(generationId, ownerId);
  if (!session) return null;
  // A dead worker cannot emit heartbeats. Reconcile stale sessions even if the
  // backend process itself has not restarted (for example, after a worker crash).
  const staleBefore = new Date(Date.now() - 120_000);
  if (session.status === 'running' && new Date(session.updatedAt || session.startedAt) < staleBefore) {
    const recovered = await interruptStaleSession(session, ownerId, 'The generation worker stopped updating this session. Previously persisted events are available; the unfinished provider request could not be resumed.', staleBefore);
    session = recovered || await getGenerationSession(generationId, ownerId);
  }
  return { status: session.status, events: (session.events || []).filter((event) => Number(event.eventId || 0) > Number(after || 0)), lastError: session.lastError || '' };
}

export async function markAbandonedGenerationSessions() {
  const now = new Date();
  if (databaseReady()) {
    const staleBefore = new Date(now.getTime() - 120_000);
    const running = await GenerationSession.find({ status: 'running', updatedAt: { $lt: staleBefore } }).select('generationId ownerId nextEventId').lean();
    for (const item of running) {
      await interruptStaleSession(item, item.ownerId, 'The server restarted while this generation was running. Previously persisted events are available, but the in-flight model request cannot be resumed at its exact token position.', staleBefore);
    }
    return { interrupted: running.length };
  }
  let interrupted = 0;
  for (const session of memory.values()) if (session.status === 'running' && now.getTime() - new Date(session.updatedAt || session.startedAt).getTime() > 120_000) {
    const event = { type: 'error', status: 503, error: 'The server restarted while this generation was running. Persisted events are available, but the in-flight model request cannot be resumed at its exact token position.', eventId: session.nextEventId++, generationId: session.generationId, recovered: true };
    session.events.push(event); session.status = 'interrupted'; session.lastError = event.error; session.updatedAt = now; session.completedAt = now; interrupted++;
  }
  return { interrupted };
}

export async function deleteGenerationSessionsForChat(chatId, ownerId) {
  if (databaseReady()) {
    const result = await GenerationSession.deleteMany({ chatId: String(chatId), ownerId: String(ownerId) });
    return result.deletedCount || 0;
  }
  let deleted = 0;
  for (const [id, session] of memory) {
    if (session.chatId === String(chatId) && session.ownerId === String(ownerId)) {
      memory.delete(id);
      deleted += 1;
    }
  }
  return deleted;
}
