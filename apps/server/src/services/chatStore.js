import mongoose from 'mongoose';
import { Chat } from '../models/Chat.js';
import logger from '../utils/logger.js';
import { ensureBranches, getBranchMessages } from './conversationBranches.js';
import { sanitizeAgentPlan, sanitizeRetrievedChat } from './conversationPrivacy.js';

const log = logger.child({ component: 'chatStore' });
const memory = new Map();
const now = () => new Date();
const id = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function cleanMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).slice(-300).map((message) => {
    const content =
      typeof message.content === 'string'
        ? message.content.slice(0, 120000)
        : Array.isArray(message.content)
          ? message.content.map((part) => {
              if (part?.type === 'text')
                return { type: 'text', text: String(part.text || '').slice(0, 20000) };
              if (part?.type === 'image_url')
                return {
                  type: 'text',
                  text: '[Image attachment was used in this turn; image bytes are not retained in chat history.]',
                };
              return { type: 'text', text: '[Multimodal attachment]' };
            })
          : String(message.content ?? '').slice(0, 120000);
    const safe = { role: message.role, content };
    if (message.id) safe.id = String(message.id).slice(0, 100);
    if (message.name) safe.name = String(message.name).slice(0, 100);
    if (Array.isArray(message.tool_calls)) safe.tool_calls = message.tool_calls;
    if (message.tool_call_id) safe.tool_call_id = message.tool_call_id;
    if (Array.isArray(message.attachments))
      safe.attachments = message.attachments.slice(0, 8).map((x) => {
        const attachment = {
          name: String(x.name || 'attachment').slice(0, 150),
          type: String(x.type || '').slice(0, 80),
        };
        const uploadId = String(x.uploadId || '');
        const sandboxPath = String(x.sandboxPath || '');
        if (
          /^[a-f0-9-]{36}$/i.test(uploadId) &&
          sandboxPath.startsWith(`uploads/${uploadId}_`) &&
          sandboxPath.length <= 240
        ) {
          attachment.uploadId = uploadId;
          attachment.sandboxPath = sandboxPath;
          if (Number.isInteger(x.size) && x.size > 0 && x.size <= 8 * 1024 * 1024)
            attachment.size = x.size;
        }
        return attachment;
      });
    if (message.usage) safe.usage = message.usage;
    if (message.durationMs != null && Number.isFinite(Number(message.durationMs)))
      safe.durationMs = Math.max(0, Number(message.durationMs));
    if (message.toolEvents) safe.toolEvents = message.toolEvents;
    if (Array.isArray(message.agentEvents)) safe.agentEvents = message.agentEvents;
    if (message.startedAt) safe.startedAt = message.startedAt;
    if (message.completedAt) safe.completedAt = message.completedAt;
    const agentPlan = sanitizeAgentPlan(message.agentPlan);
    if (agentPlan) safe.agentPlan = agentPlan;
    if (message.error) safe.error = String(message.error).slice(0, 2000);
    if (Array.isArray(message.versions))
      safe.versions = message.versions.slice(0, 20).map((v) => ({
        content: String(v.content || '').slice(0, 120000),
        toolEvents: Array.isArray(v.toolEvents) ? v.toolEvents : [],
        agentEvents: Array.isArray(v.agentEvents) ? v.agentEvents : [],
        ...(sanitizeAgentPlan(v.agentPlan) ? { agentPlan: sanitizeAgentPlan(v.agentPlan) } : {}),
        usage: v.usage,
        startedAt: v.startedAt,
        createdAt: v.createdAt,
        completedAt: v.completedAt,
        durationMs:
          v.durationMs != null && Number.isFinite(Number(v.durationMs))
            ? Math.max(0, Number(v.durationMs))
            : undefined,
      }));
    if (Number.isInteger(message.activeVersion)) safe.activeVersion = message.activeVersion;
    if (message.createdAt) safe.createdAt = message.createdAt;
    return safe;
  });
}

export async function listChats(sessionId) {
  if (mongoose.connection.readyState === 1)
    return Chat.find({ sessionId })
      .sort({ updatedAt: -1 })
      .select('_id title titleManuallyEdited activeBranchId revision createdAt updatedAt')
      .lean();
  return [...memory.values()]
    .filter((x) => x.sessionId === sessionId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ _id, title, titleManuallyEdited, activeBranchId, revision, createdAt, updatedAt }) => ({
      _id,
      title,
      titleManuallyEdited,
      activeBranchId,
      revision,
      createdAt,
      updatedAt,
    }));
}

export async function getChat(sessionId, chatId) {
  if (mongoose.connection.readyState === 1) {
    const item = await Chat.findOne({ _id: chatId, sessionId }).lean();
    return sanitizeRetrievedChat(item);
  }
  const item = memory.get(chatId);
  return item?.sessionId === sessionId ? sanitizeRetrievedChat(item) : null;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

export async function searchChatContexts(sessionId, query, { excludeChatId, limit = 5 } = {}) {
  const search = String(query || '')
    .trim()
    .slice(0, 120);
  if (!sessionId || search.length < 2) return [];
  const numericLimit = Number(limit);
  const resultLimit = Number.isFinite(numericLimit)
    ? Math.max(1, Math.min(5, Math.floor(numericLimit)))
    : 5;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(escaped, 'i');
  let candidates;

  if (mongoose.connection.readyState === 1) {
    candidates = await Chat.find({
      sessionId,
      ...(excludeChatId ? { _id: { $ne: excludeChatId } } : {}),
      $or: [
        { title: matcher },
        { 'messages.content': matcher },
        { 'messages.content.text': matcher },
        { 'branches.messages.content': matcher },
        { 'branches.messages.content.text': matcher },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(Math.max(1, Math.min(10, resultLimit * 2)))
      .lean();
  } else {
    candidates = (await listChats(sessionId)).slice(0, 100);
    candidates = await Promise.all(
      candidates
        .filter((item) => String(item._id) !== String(excludeChatId || ''))
        .map((item) => getChat(sessionId, item._id))
    );
    candidates = candidates.filter(
      (chat) =>
        chat &&
        (matcher.test(String(chat.title || '')) ||
          [
            ...(chat.messages || []),
            ...(chat.branches || []).flatMap((branch) => branch.messages || []),
          ].some((message) => matcher.test(messageText(message.content))))
    );
  }

  const results = [];
  for (const candidate of candidates) {
    if (results.length >= resultLimit) break;
    const chat = sanitizeRetrievedChat(candidate);
    if (!chat) continue;
    ensureBranches(chat);
    const branchIds = [
      chat.activeBranchId,
      ...chat.branches.map((branch) => branch.branchId),
    ].filter((branchId, index, values) => branchId && values.indexOf(branchId) === index);
    let matchingContext = null;
    for (const branchId of branchIds) {
      const messages = getBranchMessages(chat, branchId) || [];
      const relevantMessages = messages
        .map((message, index) => ({ message, index, text: messageText(message.content) }))
        .filter(({ message, text }) => ['user', 'assistant'].includes(message.role) && text.trim());
      const matchingIndices = new Set(
        relevantMessages.filter(({ text }) => matcher.test(text)).map(({ index }) => index)
      );
      if (matchingIndices.size) {
        matchingContext = { branchId, relevantMessages, matchingIndices };
        break;
      }
      if (branchId === chat.activeBranchId)
        matchingContext = { branchId, relevantMessages, matchingIndices };
    }
    const titleMatched = matcher.test(String(chat.title || ''));
    if (!matchingContext?.matchingIndices.size && !titleMatched) continue;

    const selected =
      titleMatched && !matchingContext?.matchingIndices.size
        ? matchingContext?.relevantMessages.slice(-6) || []
        : matchingContext?.relevantMessages.filter(
            ({ index, message }) =>
              matchingContext.matchingIndices.has(index) ||
              matchingContext.relevantMessages.some(
                ({ index: matchIndex, message: matchingMessage }) =>
                  matchingContext.matchingIndices.has(matchIndex) &&
                  Math.abs(matchIndex - index) === 1 &&
                  matchingMessage.role !== message.role
              )
          ) || [];
    results.push({
      chatId: String(chat._id),
      branchId: matchingContext?.branchId || chat.activeBranchId,
      title: String(chat.title || 'Untitled chat').slice(0, 120),
      updatedAt: chat.updatedAt || null,
      messages: selected.slice(-8).map(({ message, text }) => ({
        role: message.role,
        content: text.slice(0, 1800),
        createdAt: message.createdAt || null,
      })),
    });
  }
  return results;
}

export async function createChat(sessionId, title = 'New chat') {
  const initialMessages = [];
  const doc = {
    sessionId,
    title: String(title).slice(0, 120) || 'New chat',
    titleManuallyEdited: false,
    messages: initialMessages,
    branches: [
      {
        branchId: 'main',
        parentBranchId: null,
        forkedFromMessageId: null,
        messages: initialMessages,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    activeBranchId: 'main',
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  if (mongoose.connection.readyState === 1) {
    const created = await Chat.create(doc);
    return created.toObject();
  }
  const created = { ...doc, _id: id() };
  memory.set(created._id, created);
  return created;
}

export async function updateChat(sessionId, chatId, patch) {
  const values = { ...patch, updatedAt: now() };
  const expectedRevision = values.expectedRevision;
  delete values.expectedRevision;
  if (values.messages) values.messages = cleanMessages(values.messages);
  if (values.title) values.title = String(values.title).slice(0, 120);
  if (Array.isArray(values.branches))
    values.branches = values.branches.map((branch) => ({
      ...branch,
      messages: cleanMessages(branch.messages || []),
    }));
  if (mongoose.connection.readyState === 1) {
    const updated = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        sessionId,
        ...(Number.isInteger(expectedRevision) ? { revision: expectedRevision } : {}),
      },
      { $set: values },
      { new: true }
    ).lean();
    if (!updated) return null;
    return sanitizeRetrievedChat(updated);
  }
  const current = memory.get(chatId);
  if (
    !current ||
    current.sessionId !== sessionId ||
    (Number.isInteger(expectedRevision) && (current.revision || 0) !== expectedRevision)
  ) {
    return null;
  }
  const next = { ...current, ...values };
  memory.set(chatId, next);
  return sanitizeRetrievedChat(next);
}

export async function deleteChat(sessionId, chatId) {
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
