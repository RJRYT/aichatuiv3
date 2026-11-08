import mongoose from 'mongoose';
import { Chat } from '../models/Chat.js';
import logger from '../utils/logger.js';

const log = logger.child({ component: 'chatStore' });
const memory = new Map();
const now = () => new Date();
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function cleanMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).slice(-300).map((message) => {
    const content = typeof message.content === 'string'
      ? message.content.slice(0, 120000)
      : Array.isArray(message.content)
        ? message.content.map((part) => {
            if (part?.type === 'text') return { type: 'text', text: String(part.text || '').slice(0, 20000) };
            if (part?.type === 'image_url') return { type: 'text', text: '[Image attachment was used in this turn; image bytes are not retained in chat history.]' };
            return { type: 'text', text: '[Multimodal attachment]' };
          })
        : String(message.content ?? '').slice(0, 120000);
    const safe = { role: message.role, content };
    if (message.id) safe.id = String(message.id).slice(0, 100);
    if (message.name) safe.name = String(message.name).slice(0, 100);
    if (Array.isArray(message.tool_calls)) safe.tool_calls = message.tool_calls;
    if (message.tool_call_id) safe.tool_call_id = message.tool_call_id;
    if (Array.isArray(message.attachments)) safe.attachments = message.attachments.slice(0, 8).map((x) => {
      const attachment = { name: String(x.name || 'attachment').slice(0, 150), type: String(x.type || '').slice(0, 80) };
      const uploadId = String(x.uploadId || '');
      const sandboxPath = String(x.sandboxPath || '');
      if (/^[a-f0-9-]{36}$/i.test(uploadId) && sandboxPath.startsWith(`uploads/${uploadId}_`) && sandboxPath.length <= 240) {
        attachment.uploadId = uploadId;
        attachment.sandboxPath = sandboxPath;
        if (Number.isInteger(x.size) && x.size > 0 && x.size <= 8 * 1024 * 1024) attachment.size = x.size;
      }
      return attachment;
    });
    if (message.reasoning) safe.reasoning = String(message.reasoning).slice(0, 50000);
    if (message.usage) safe.usage = message.usage;
    if (message.durationMs != null) safe.durationMs = Number(message.durationMs);
    if (message.toolEvents) safe.toolEvents = message.toolEvents;
    if (message.error) safe.error = String(message.error).slice(0, 2000);
    if (Array.isArray(message.versions)) safe.versions = message.versions.slice(0, 20).map(v => ({ content: String(v.content || '').slice(0, 120000), reasoning: String(v.reasoning || '').slice(0, 50000), toolEvents: Array.isArray(v.toolEvents) ? v.toolEvents : [], usage: v.usage, createdAt: v.createdAt }));
    if (Number.isInteger(message.activeVersion)) safe.activeVersion = message.activeVersion;
    if (message.createdAt) safe.createdAt = message.createdAt;
    return safe;
  });
}

export async function listChats(sessionId) {
  if (mongoose.connection.readyState === 1) return Chat.find({ sessionId }).sort({ updatedAt: -1 }).select('_id title titleManuallyEdited activeBranchId revision createdAt updatedAt').lean();
  return [...memory.values()].filter((x) => x.sessionId === sessionId).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(({ _id, title, titleManuallyEdited, activeBranchId, revision, createdAt, updatedAt }) => ({ _id, title, titleManuallyEdited, activeBranchId, revision, createdAt, updatedAt }));
}

export async function getChat(sessionId, chatId) {
  if (mongoose.connection.readyState === 1) return Chat.findOne({ _id: chatId, sessionId }).lean();
  const item = memory.get(chatId);
  return item?.sessionId === sessionId ? item : null;
}

export async function createChat(sessionId, title = 'New chat') {
  const initialMessages = [];
  const doc = { sessionId, title: String(title).slice(0, 120) || 'New chat', titleManuallyEdited: false, messages: initialMessages, branches: [{ branchId: 'main', parentBranchId: null, forkedFromMessageId: null, messages: initialMessages, createdAt: now(), updatedAt: now() }], activeBranchId: 'main', revision: 0, createdAt: now(), updatedAt: now() };
  log.debug('Creating chat', { sessionId, title });
  if (mongoose.connection.readyState === 1) {
    const created = await Chat.create(doc);
    log.info('Chat created', { sessionId, chatId: String(created._id), title });
    return created.toObject();
  }
  const created = { ...doc, _id: id() };
  memory.set(created._id, created);
  log.info('Chat created (in-memory)', { sessionId, chatId: String(created._id), title });
  return created;
}

export async function updateChat(sessionId, chatId, patch) {
  const values = { ...patch, updatedAt: now() };
  const expectedRevision = values.expectedRevision; delete values.expectedRevision;
  if (values.messages) values.messages = cleanMessages(values.messages);
  if (values.title) values.title = String(values.title).slice(0, 120);
  if (Array.isArray(values.branches)) values.branches = values.branches.map(branch => ({ ...branch, messages: cleanMessages(branch.messages || []) }));
  log.debug('Updating chat', { sessionId, chatId, expectedRevision });
  if (mongoose.connection.readyState === 1) {
    const updated = await Chat.findOneAndUpdate({ _id: chatId, sessionId, ...(Number.isInteger(expectedRevision) ? { revision: expectedRevision } : {}) }, { $set: values }, { new: true }).lean();
    if (!updated) {
      log.warn('Chat update failed: not found or revision conflict', { sessionId, chatId });
      return null;
    }
    log.info('Chat updated', { sessionId, chatId });
    return updated;
  }
  const current = memory.get(chatId);
  if (!current || current.sessionId !== sessionId || (Number.isInteger(expectedRevision) && (current.revision || 0) !== expectedRevision)) {
    log.warn('Chat update failed: not found or revision conflict (in-memory)', { sessionId, chatId });
    return null;
  }
  const next = { ...current, ...values };
  memory.set(chatId, next);
  log.info('Chat updated (in-memory)', { sessionId, chatId });
  return next;
}

export async function deleteChat(sessionId, chatId) {
  log.debug('Deleting chat', { sessionId, chatId });
  if (mongoose.connection.readyState === 1) {
    const result = await Chat.deleteOne({ _id: chatId, sessionId });
    if (result.deletedCount > 0) {
      log.info('Chat deleted', { sessionId, chatId });
      return true;
    }
    log.warn('Chat delete failed: not found', { sessionId, chatId });
    return false;
  }
  const current = memory.get(chatId);
  if (!current || current.sessionId !== sessionId) {
    log.warn('Chat delete failed: not found (in-memory)', { sessionId, chatId });
    return false;
  }
  memory.delete(chatId);
  log.info('Chat deleted (in-memory)', { sessionId, chatId });
  return true;
}
