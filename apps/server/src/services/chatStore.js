import mongoose from 'mongoose';
import { Chat } from '../models/Chat.js';
import logger from '../utils/logger.js';

const chatLog = logger.child({ component: 'chatStore' });

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
    if (Array.isArray(message.attachments)) safe.attachments = message.attachments.slice(0, 8).map((x) => ({ name: String(x.name || 'attachment').slice(0, 150), type: String(x.type || '').slice(0, 80) }));
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
  if (mongoose.connection.readyState === 1) {
    const chats = await Chat.find({ sessionId }).sort({ updatedAt: -1 }).select('_id title titleManuallyEdited activeBranchId revision messages createdAt updatedAt').lean();
    chatLog.debug('Chats listed.', { sessionId, count: chats.length });
    return chats;
  }
  const chats = [...memory.values()].filter((x) => x.sessionId === sessionId).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  chatLog.debug('Chats listed (memory).', { sessionId, count: chats.length });
  return chats;
}

export async function getChat(sessionId, chatId) {
  if (mongoose.connection.readyState === 1) {
    const chat = await Chat.findOne({ _id: chatId, sessionId }).lean();
    if (!chat) chatLog.debug('Chat not found.', { chatId, sessionId });
    return chat;
  }
  const item = memory.get(chatId);
  if (!item || item.sessionId !== sessionId) {
    chatLog.debug('Chat not found (memory).', { chatId, sessionId });
    return null;
  }
  return item;
}

export async function createChat(sessionId, title = 'New chat') {
  const initialMessages = [];
  const doc = { sessionId, title: String(title).slice(0, 120) || 'New chat', titleManuallyEdited: false, messages: initialMessages, branches: [{ branchId: 'main', parentBranchId: null, forkedFromMessageId: null, messages: initialMessages, createdAt: now(), updatedAt: now() }], activeBranchId: 'main', revision: 0, createdAt: now(), updatedAt: now() };
  if (mongoose.connection.readyState === 1) {
    const created = await Chat.create(doc);
    chatLog.info('Chat created.', { chatId: String(created._id), sessionId, title: doc.title });
    return created.toObject();
  }
  const created = { ...doc, _id: id() };
  chatLog.info('Chat created (memory).', { chatId: String(created._id), sessionId, title: doc.title });
  memory.set(created._id, created);
  return created;
}

export async function updateChat(sessionId, chatId, patch) {
  const values = { ...patch, updatedAt: now() };
  const expectedRevision = values.expectedRevision; delete values.expectedRevision;
  if (values.messages) values.messages = cleanMessages(values.messages);
  if (values.title) values.title = String(values.title).slice(0, 120);
  if (Array.isArray(values.branches)) values.branches = values.branches.map(branch => ({ ...branch, messages: cleanMessages(branch.messages || []) }));
  if (mongoose.connection.readyState === 1) {
    const updated = await Chat.findOneAndUpdate({ _id: chatId, sessionId, ...(Number.isInteger(expectedRevision) ? { revision: expectedRevision } : {}) }, { $set: values }, { new: true }).lean();
    if (!updated) {
      chatLog.warn('Chat update conflict (not found or revision mismatch).', { chatId, sessionId, expectedRevision });
      return null;
    }
    chatLog.debug('Chat updated.', { chatId, sessionId, fields: Object.keys(patch) });
    return updated;
  }
  const current = memory.get(chatId);
  if (!current || current.sessionId !== sessionId || (Number.isInteger(expectedRevision) && (current.revision || 0) !== expectedRevision)) {
    chatLog.warn('Chat update conflict (not found or revision mismatch).', { chatId, sessionId, expectedRevision });
    return null;
  }
  const next = { ...current, ...values };
  chatLog.debug('Chat updated (memory).', { chatId, sessionId, fields: Object.keys(patch) });
  memory.set(chatId, next);
  return next;
}

export async function deleteChat(sessionId, chatId) {
  if (mongoose.connection.readyState === 1) {
    const result = await Chat.deleteOne({ _id: chatId, sessionId });
    if (result.deletedCount > 0) {
      chatLog.info('Chat deleted.', { chatId, sessionId });
      return true;
    }
    chatLog.warn('Chat delete attempted but not found.', { chatId, sessionId });
    return false;
  }
  const current = memory.get(chatId);
  if (!current || current.sessionId !== sessionId) {
    chatLog.warn('Chat delete attempted but not found (memory).', { chatId, sessionId });
    return false;
  }
  chatLog.info('Chat deleted (memory).', { chatId, sessionId });
  memory.delete(chatId);
  return true;
}
