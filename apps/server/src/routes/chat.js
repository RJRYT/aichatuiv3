import { Router } from 'express';
import { runNemotronChat, generateChatTitle } from '../services/nvidia.js';
import { getChat, updateChat } from '../services/chatStore.js';
import {
  ensureBranches,
  getBranchMessages,
  setBranchMessages,
} from '../services/conversationBranches.js';
import logger from '../utils/logger.js';

const router = Router();
const log = logger.child({ component: 'routes:chat' });
router.post('/stream', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || '');
    const chatId = String(req.body?.chatId || '');
    log.info('Chat stream started', { userId: ownerId, chatId });
    if (!ownerId || !chatId) {
      log.warn('Chat ID missing', { userId: ownerId });
      return res.status(400).json({ error: 'Chat ID is required.' });
    }
    if (
      !Array.isArray(req.body?.messages) ||
      !req.body.messages.length ||
      req.body.messages.length > 300
    )
      return res.status(400).json({ error: 'Provide between 1 and 300 conversation messages.' });
    for (const message of req.body.messages) {
      if (
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        message.tool_calls ||
        message.tool_call_id ||
        message.name
      )
        return res
          .status(400)
          .json({ error: 'Only plain user and assistant messages are accepted from the client.' });
      if (
        message.attachments != null &&
        (!Array.isArray(message.attachments) ||
          message.attachments.length > 6 ||
          message.attachments.some(
            (file) =>
              !file ||
              typeof file.name !== 'string' ||
              file.name.length > 140 ||
              typeof file.type !== 'string' ||
              file.type.length > 120 ||
              (file.uploadId != null && !/^[a-f0-9-]{36}$/i.test(file.uploadId)) ||
              (file.sandboxPath != null &&
                (typeof file.sandboxPath !== 'string' ||
                  !file.sandboxPath.startsWith(`uploads/${file.uploadId}_`)))
          ))
      )
        return res.status(400).json({ error: 'Invalid message attachment metadata.' });
      if (typeof message.content === 'string') {
        if (message.content.length > 120000)
          return res.status(413).json({ error: 'A message exceeds the 120,000 character limit.' });
      } else if (Array.isArray(message.content)) {
        if (
          message.content.length > 100 ||
          message.content.some(
            (part) =>
              !part ||
              (part.type === 'text'
                ? typeof part.text !== 'string' || part.text.length > 20000
                : part.type === 'image_url'
                  ? typeof part.image_url?.url !== 'string' ||
                    !part.image_url.url.startsWith('data:image/') ||
                    part.image_url.url.length > 22 * 1024 * 1024
                  : true)
          )
        )
          return res
            .status(400)
            .json({ error: 'Unsupported or oversized multimodal message content.' });
      } else
        return res
          .status(400)
          .json({ error: 'Message content must be text or supported image parts.' });
    }
    const existing = await getChat(ownerId, chatId);
    if (!existing) {
      log.warn('Chat not found for stream', { userId: ownerId, chatId });
      return res.status(404).json({ error: 'Chat not found.' });
    }
    log.debug('Chat found for stream', { userId: ownerId, chatId });
    ensureBranches(existing);
    const requestedBranchId = String(req.body?.branchId || existing.activeBranchId || 'main');
    if (!getBranchMessages(existing, requestedBranchId)) {
      log.warn('Conversation branch not found', {
        userId: ownerId,
        chatId,
        branchId: requestedBranchId,
      });
      return res.status(404).json({ error: 'Conversation branch not found.' });
    }
    if (
      req.body?.preserveExistingMessageId &&
      !getBranchMessages(existing, requestedBranchId).some(
        (message) => message.id === req.body.preserveExistingMessageId
      )
    ) {
      log.warn('Response to regenerate not found', {
        userId: ownerId,
        chatId,
        messageId: req.body.preserveExistingMessageId,
      });
      return res
        .status(404)
        .json({ error: 'Response to regenerate was not found in this branch.' });
    }
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (existing.revision || 0)
    ) {
      log.warn('Revision conflict on stream', { userId: ownerId, chatId });
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before generating.' });
    }
    if (!process.env.NVIDIA_API_KEY) {
      log.error('NVIDIA_API_KEY missing on backend');
      return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    await runNemotronChat({
      body: req.body,
      req,
      res,
      user: req.user,
      persist: async (generatedMessages) => {
        const current = await getChat(ownerId, chatId);
        if (!current) return;
        ensureBranches(current);
        const branchId = String(req.body.branchId || current.activeBranchId || 'main');
        if (req.body.preserveExistingMessageId) {
          const branchMessages = getBranchMessages(current, branchId);
          const target = branchMessages?.find((m) => m.id === req.body.preserveExistingMessageId);
          const alternative = generatedMessages[generatedMessages.length - 1];
          if (!target || !alternative)
            throw Object.assign(new Error('The response version target is no longer available.'), {
              status: 409,
            });
          if (target && alternative) {
            target.versions = Array.isArray(target.versions)
              ? target.versions
              : [
                  {
                    content: target.content,
                    toolEvents: target.toolEvents,
                    agentPlan: target.agentPlan,
                    usage: target.usage,
                    createdAt: target.createdAt,
                  },
                ];
            target.versions.push({
              content: alternative.content,
              toolEvents: alternative.toolEvents,
              agentPlan: alternative.agentPlan,
              usage: alternative.usage,
              createdAt: alternative.createdAt,
            });
            target.activeVersion = target.versions.length - 1;
            Object.assign(target, target.versions[target.activeVersion]);
            setBranchMessages(current, branchId, branchMessages);
          }
        } else {
          ensureBranches(current);
          if (!setBranchMessages(current, branchId, generatedMessages))
            throw Object.assign(new Error('Conversation branch no longer exists.'), {
              status: 409,
            });
        }
        const saved = await updateChat(ownerId, chatId, {
          branches: current.branches,
          messages: current.messages,
          activeBranchId: branchId,
          revision: (current.revision || 0) + 1,
          expectedRevision: req.body.expectedRevision ?? (existing.revision || 0),
        });
        if (!saved) {
          log.warn('Conversation changed during generation', { userId: ownerId, chatId });
          throw Object.assign(
            new Error(
              'Conversation changed while this response was generating. Refresh and retry.'
            ),
            { status: 409 }
          );
        }
        log.info('Chat response persisted', {
          userId: ownerId,
          chatId,
          messageCount: generatedMessages.length,
        });
        return saved;
      },
    });
  } catch (error) {
    next(error);
  }
});
router.post('/title', async (req, res, next) => {
  try {
    if (!process.env.NVIDIA_API_KEY)
      return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    const title = await generateChatTitle(req.body?.text || '');
    res.json({ title });
  } catch (error) {
    next(error);
  }
});
export default router;
