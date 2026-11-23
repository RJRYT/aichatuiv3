import { Router } from 'express';
import { createChat, deleteChat, getChat, listChats, updateChat } from '../services/chatStore.js';
import {
  ensureBranches,
  getBranchMessages,
  createBranch,
  setBranchMessages,
} from '../services/conversationBranches.js';
import logger from '../utils/logger.js';
import { aggregateUsageFromChats } from '../services/usageAnalytics.js';
import { deleteSandboxForChat } from '../services/interpreter/sandboxManager.js';
import { deleteWorkspaceForChat } from '../services/workspace/workspaceManager.js';
import { deleteAgentCheckpointsForChat } from '../services/agents/checkpointManager.js';
import {
  storeConversationUploads,
  deleteConversationUploads,
} from '../services/interpreter/uploadStore.js';

const router = Router();
const owner = (req) => String(req.user?._id || '');
const log = logger.child({ component: 'routes:chats' });
router.get('/usage', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const indexSince = new Date(Date.now() - (days + 2) * 86400000);
    const index = (await listChats(owner(req))).filter((item) => new Date(item.updatedAt || item.createdAt || 0) >= indexSince);
    // listChats intentionally returns only lightweight index rows. Hydrate each chat before
    // calculating usage; otherwise branch messages are absent and the dashboard reports zero.
    const chats = (await Promise.all(index.map((item) => getChat(owner(req), String(item._id))))).filter(Boolean);
    const analytics = aggregateUsageFromChats(chats, days);
    res.json({ usage: { days, ...analytics, folders: [...new Set(chats.map((chat) => String(chat.folder || '')).filter(Boolean))].sort(), tagCounts: {} } });
  } catch (error) { next(error); }
});
router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const chats = await listChats(owner(req));
    res.json({ chats });
  } catch (error) {
    next(error);
  }
});
router.post('/', async (req, res, next) => {
  try {
    const chat = await createChat(owner(req), req.body?.title);
    res.status(201).json({ chat });
  } catch (error) {
    next(error);
  }
});
router.post('/:id/uploads', async (req, res, next) => {
  try {
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) return res.status(404).json({ error: 'Conversation not found.' });
    const uploads = await storeConversationUploads(
      owner(req),
      req.params.id,
      req.body?.files || []
    );
    return res.status(201).json({ uploads });
  } catch (error) {
    next(error);
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found.' });
    }
    ensureBranches(chat);
    const branchId = req.query.branchId || chat.activeBranchId || 'main';
    const messages = getBranchMessages(chat, branchId);
    if (!messages) return res.status(404).json({ error: 'Conversation branch not found.' });
    chat.activeBranchId = branchId;
    res.json({
      chat: {
        ...chat,
        messages,
        branches: chat.branches.map((b) => ({
          branchId: b.branchId,
          parentBranchId: b.parentBranchId,
          forkedFromMessageId: b.forkedFromMessageId,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});
router.patch('/:id', async (req, res, next) => {
  try {
    const current = await getChat(owner(req), req.params.id);
    if (!current) {
      return res.status(404).json({ error: 'Chat not found.' });
    }
    const patch = {};
    if (
      typeof req.body?.title === 'string' &&
      current.titleManuallyEdited &&
      req.body?.manualTitle !== true
    )
      return res.json({ chat: current });
    if (typeof req.body?.title === 'string') {
      patch.title = req.body.title.slice(0, 120);
      if (req.body.manualTitle === true) patch.titleManuallyEdited = true;
    }
    if (typeof req.body?.pinned === 'boolean') patch.pinned = req.body.pinned;
    if (typeof req.body?.folder === 'string') patch.folder = req.body.folder.trim().slice(0, 60);
    if (Array.isArray(req.body?.tags)) {
      const tags = [
        ...new Set(
          req.body.tags
            .filter((tag) => typeof tag === 'string')
            .map((tag) => tag.trim().slice(0, 24))
            .filter(Boolean)
        ),
      ].slice(0, 12);
      patch.tags = tags;
    }
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (current.revision || 0)
    )
      return res.status(409).json({
        error: 'This conversation changed elsewhere. Refresh before saving.',
        revision: current.revision || 0,
      });
    if (Array.isArray(req.body?.messages)) {
      if (
        req.body.messages.length > 300 ||
        req.body.messages.some(
          (message) => !message || !['user', 'assistant'].includes(message.role)
        )
      )
        return res
          .status(400)
          .json({ error: 'Messages must contain at most 300 user or assistant entries.' });
      ensureBranches(current);
      const branchId = String(req.body.branchId || current.activeBranchId || 'main');
      if (!setBranchMessages(current, branchId, req.body.messages))
        return res.status(404).json({ error: 'Conversation branch not found.' });
      patch.branches = current.branches;
      patch.messages = current.messages;
      patch.activeBranchId = branchId;
    }
    patch.revision = (current.revision || 0) + 1;
    if (Number.isInteger(req.body?.expectedRevision))
      patch.expectedRevision = req.body.expectedRevision;
    const chat = await updateChat(owner(req), req.params.id, patch);
    if (!chat)
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before saving.' });
    res.json({ chat });
  } catch (error) {
    next(error);
  }
});
router.post('/:id/branches', async (req, res, next) => {
  try {
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (chat.revision || 0)
    )
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before branching.' });
    const branchMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (
      branchMessages.length > 300 ||
      branchMessages.some((message) => !message || !['user', 'assistant'].includes(message.role))
    )
      return res
        .status(400)
        .json({ error: 'Branch messages must contain at most 300 user or assistant entries.' });
    const created = createBranch(chat, {
      fromBranchId: String(req.body?.fromBranchId || chat.activeBranchId || 'main'),
      forkedFromMessageId: req.body?.forkedFromMessageId
        ? String(req.body.forkedFromMessageId)
        : null,
      messages: branchMessages,
    });
    const updated = await updateChat(owner(req), req.params.id, {
      branches: chat.branches,
      activeBranchId: created.branch.branchId,
      revision: (chat.revision || 0) + 1,
      expectedRevision: req.body?.expectedRevision ?? (chat.revision || 0),
    });
    if (!updated)
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before branching.' });
    res.status(201).json({ chat: updated, branch: created.branch, messages: created.messages });
  } catch (error) {
    next(error);
  }
});
router.patch('/:id/branches/:branchId/activate', async (req, res, next) => {
  try {
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    const messages = getBranchMessages(chat, req.params.branchId);
    if (!messages) return res.status(404).json({ error: 'Branch not found.' });
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (chat.revision || 0)
    )
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before switching branches.' });
    const updated = await updateChat(owner(req), req.params.id, {
      activeBranchId: req.params.branchId,
      revision: (chat.revision || 0) + 1,
      expectedRevision: req.body?.expectedRevision ?? (chat.revision || 0),
    });
    if (!updated)
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before switching branches.' });
    res.json({ chat: updated, messages });
  } catch (error) {
    next(error);
  }
});
router.post('/:id/messages/:messageId/versions', async (req, res, next) => {
  try {
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(chat);
    const branchId = String(req.body?.branchId || chat.activeBranchId || 'main');
    const messages = getBranchMessages(chat, branchId);
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (chat.revision || 0)
    )
      return res.status(409).json({
        error: 'This conversation changed elsewhere. Refresh before updating response versions.',
      });
    const message = messages?.find((m) => m.id === req.params.messageId);
    if (!message || message.role !== 'assistant')
      return res.status(404).json({ error: 'Assistant response not found.' });
    message.versions = Array.isArray(message.versions)
      ? message.versions
      : [
          {
            content: message.content,
            toolEvents: message.toolEvents,
            agentPlan: message.agentPlan,
            usage: message.usage,
            usageByModel: message.usageByModel,
            modelCallsByModel: message.modelCallsByModel,
            model: message.model,
            modelMode: message.modelMode,
            routingDecision: message.routingDecision,
            startedAt: message.startedAt,
            createdAt: message.createdAt,
            completedAt: message.completedAt,
            durationMs: message.durationMs,
            agentEvents: message.agentEvents,
          },
        ];
    message.versions.push({
      content: String(req.body?.content || '').slice(0, 120000),
      toolEvents: Array.isArray(req.body?.toolEvents) ? req.body.toolEvents : [],
      agentPlan: req.body?.agentPlan,
      agentEvents: Array.isArray(req.body?.agentEvents) ? req.body.agentEvents : [],
      usage: req.body?.usage,
      usageByModel: req.body?.usageByModel,
      modelCallsByModel: req.body?.modelCallsByModel,
      model: req.body?.model,
      modelMode: req.body?.modelMode,
      routingDecision: req.body?.routingDecision,
      startedAt: req.body?.startedAt,
      createdAt: req.body?.startedAt || new Date(),
      completedAt: new Date(),
      durationMs:
        req.body?.durationMs != null && Number.isFinite(Number(req.body.durationMs))
          ? Math.max(0, Number(req.body.durationMs))
          : undefined,
    });
    message.activeVersion = message.versions.length - 1;
    setBranchMessages(chat, branchId, messages);
    const updated = await updateChat(owner(req), req.params.id, {
      branches: chat.branches,
      messages: chat.messages,
      revision: (chat.revision || 0) + 1,
      expectedRevision: req.body?.expectedRevision ?? (chat.revision || 0),
    });
    if (!updated)
      return res.status(409).json({
        error: 'This conversation changed elsewhere. Refresh before updating response versions.',
      });
    res.json({ chat: updated, message });
  } catch (error) {
    next(error);
  }
});
router.patch('/:id/messages/:messageId/version', async (req, res, next) => {
  try {
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(chat);
    const branchId = String(req.body?.branchId || chat.activeBranchId || 'main');
    const messages = getBranchMessages(chat, branchId);
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (chat.revision || 0)
    )
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before switching versions.' });
    const message = messages?.find((m) => m.id === req.params.messageId);
    const index = Number(req.body?.index);
    if (
      !message?.versions?.length ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= message.versions.length
    )
      return res.status(400).json({ error: 'Invalid response version.' });

    const version = message.versions[index];
    Object.assign(message, version, { versions: message.versions, activeVersion: index });
    setBranchMessages(chat, branchId, messages);
    const updated = await updateChat(owner(req), req.params.id, {
      branches: chat.branches,
      messages: chat.messages,
      revision: (chat.revision || 0) + 1,
      expectedRevision: req.body?.expectedRevision ?? (chat.revision || 0),
    });
    if (!updated)
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before switching versions.' });
    res.json({ chat: updated, messages });
  } catch (error) {
    next(error);
  }
});
router.patch('/:id/messages/:messageId', async (req, res, next) => {
  try {
    const chat = await getChat(owner(req), req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(chat);
    const branchId = String(req.body?.branchId || chat.activeBranchId || 'main');
    const messages = getBranchMessages(chat, branchId);
    if (!messages) return res.status(404).json({ error: 'Conversation branch not found.' });
    const message = messages?.find((m) => m.id === req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found.' });
    if (typeof req.body?.content !== 'string' || !req.body.content.trim())
      return res.status(400).json({ error: 'A non-empty content string is required.' });
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (chat.revision || 0)
    )
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before editing.' });
    const nextContent = req.body.content.slice(0, 200000);
    if (message.role === 'assistant') {
      message.versions = [
        ...(message.versions || []),
        {
          id: message.id,
          content: nextContent,
          createdAt: message.createdAt,
          edited: true,
        },
      ];
      message.activeVersion = message.versions.length - 1;
    }
    message.content = nextContent;
    message.edited = true;
    setBranchMessages(chat, branchId, messages);
    const updated = await updateChat(owner(req), req.params.id, {
      branches: chat.branches,
      messages: chat.messages,
      revision: (chat.revision || 0) + 1,
      expectedRevision: req.body?.expectedRevision ?? (chat.revision || 0),
    });
    if (!updated)
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before editing.' });
    res.json({ chat: updated, messages });
  } catch (error) {
    next(error);
  }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await deleteChat(owner(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Chat not found.' });
    await deleteSandboxForChat(owner(req), req.params.id);
    await deleteWorkspaceForChat(owner(req), req.params.id);
    await deleteAgentCheckpointsForChat(owner(req), req.params.id);
    await deleteConversationUploads(owner(req), req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
export default router;
