import { Router } from 'express';
import { runNemotronChat, generateChatTitle, requestStopChatGeneration, generateSuggestedNextSteps } from '../services/nvidia.js';
import { getChat, updateChat } from '../services/chatStore.js';
import {
  ensureBranches,
  getBranchMessages,
  setBranchMessages,
} from '../services/conversationBranches.js';
import logger from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { createGenerationSession, appendGenerationEvent, finishGenerationSession, getGenerationEvents, getGenerationSession } from '../services/generationSessions.js';

const router = Router();
const log = logger.child({ component: 'routes:chat' });
router.post('/suggestions', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || '');
    const chatId = String(req.body?.chatId || '');
    const messageId = String(req.body?.messageId || '');
    if (!ownerId || !chatId || !messageId) return res.status(400).json({ error: 'Chat and assistant message IDs are required.' });
    const chat = await getChat(ownerId, chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(chat);
    const branchId = String(req.body?.branchId || chat.activeBranchId || 'main');
    const messages = getBranchMessages(chat, branchId);
    const assistant = messages?.find((item) => item.id === messageId && item.role === 'assistant');
    if (!assistant || !assistant.content) return res.status(404).json({ error: 'Completed assistant response not found.' });
    if (Array.isArray(assistant.suggestedNextSteps) && assistant.suggestedNextSteps.length) return res.json({ suggestions: assistant.suggestedNextSteps, revision: chat.revision || 0 });
    const index = messages.indexOf(assistant);
    const previousUser = [...messages.slice(0, index)].reverse().find((item) => item.role === 'user');
    const suggestions = await generateSuggestedNextSteps({ user: req.user, userPrompt: previousUser?.content, assistantResponse: assistant.content, toolEvents: assistant.toolEvents, agentPlan: assistant.agentPlan });
    assistant.suggestedNextSteps = suggestions;
    const saved = await updateChat(ownerId, chatId, { branches: chat.branches, messages: chat.messages, revision: (chat.revision || 0) + 1, expectedRevision: chat.revision || 0 });
    if (!saved) return res.status(409).json({ error: 'Conversation changed while suggestions were being generated.' });
    return res.json({ suggestions, revision: saved.revision || 0 });
  } catch (error) { next(error); }
});

router.post('/stream', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || '');
    const chatId = String(req.body?.chatId || '');
    if (!ownerId || !chatId) {
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
      return res.status(404).json({ error: 'Chat not found.' });
    }
    ensureBranches(existing);
    const requestedBranchId = String(req.body?.branchId || existing.activeBranchId || 'main');
    if (!getBranchMessages(existing, requestedBranchId)) {
      return res.status(404).json({ error: 'Conversation branch not found.' });
    }
    if (
      req.body?.preserveExistingMessageId &&
      !getBranchMessages(existing, requestedBranchId).some(
        (message) => message.id === req.body.preserveExistingMessageId
      )
    ) {
      return res
        .status(404)
        .json({ error: 'Response to regenerate was not found in this branch.' });
    }
    if (
      Number.isInteger(req.body?.expectedRevision) &&
      req.body.expectedRevision !== (existing.revision || 0)
    ) {
      return res
        .status(409)
        .json({ error: 'This conversation changed elsewhere. Refresh before generating.' });
    }
    if (!process.env.NVIDIA_API_KEY) {
      log.error('NVIDIA_API_KEY missing on backend');
      return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    }
    const generationId = String(req.body?.generationId || randomUUID());
    if (!/^[a-f0-9-]{36}$/i.test(generationId)) return res.status(400).json({ error: 'Invalid generation ID.' });
    await createGenerationSession({ generationId, ownerId, chatId });
    let eventId = 0;
    let persistenceQueue = Promise.resolve();
    res.publishEvent = (payload) => {
      const event = { ...payload, eventId: ++eventId, generationId };
      // Keep the durable replay log comfortably below MongoDB's document limit.
      // The live SSE receives the full event; the final chat record remains the
      // source of truth for complete content and tool results.
      let persisted = { ...event };
      for (const field of ['content', 'message', 'error']) {
        if (typeof persisted[field] === 'string' && Buffer.byteLength(persisted[field], 'utf8') > 1200) {
          persisted[field] = `${persisted[field].slice(0, 1200)}\n[Replay event truncated; consult the saved chat/tool result.]`;
          persisted.replayTruncated = true;
        }
      }
      if (Buffer.byteLength(JSON.stringify(persisted), 'utf8') > 2048) {
        const compact = { type: event.type, eventId: event.eventId, generationId, replayTruncated: true };
        for (const field of ['name', 'status', 'round', 'phase']) {
          if (typeof event[field] === 'string' || typeof event[field] === 'number') compact[field] = event[field];
        }
        if (typeof event.message === 'string') compact.message = event.message.slice(0, 300);
        if (typeof event.error === 'string') compact.error = event.error.slice(0, 300);
        persisted = compact;
      }
      persistenceQueue = persistenceQueue.then(() => appendGenerationEvent(generationId, ownerId, persisted));
      return event;
    };
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
                    agentEvents: target.agentEvents,
                    usage: target.usage,
                    usageByModel: target.usageByModel,
                    modelCallsByModel: target.modelCallsByModel,
                    model: target.model,
                    modelMode: target.modelMode,
                    routingDecision: target.routingDecision,
                    startedAt: target.startedAt,
                    createdAt: target.createdAt,
                    completedAt: target.completedAt,
                    durationMs: target.durationMs,
                  },
                ];
            target.versions.push({
              content: alternative.content,
              toolEvents: alternative.toolEvents,
              agentPlan: alternative.agentPlan,
              agentEvents: alternative.agentEvents,
              usage: alternative.usage,
              usageByModel: alternative.usageByModel,
              modelCallsByModel: alternative.modelCallsByModel,
              model: alternative.model,
              modelMode: alternative.modelMode,
              routingDecision: alternative.routingDecision,
              startedAt: alternative.startedAt,
              createdAt: alternative.createdAt,
              completedAt: alternative.completedAt,
              durationMs: alternative.durationMs,
            });
            target.activeVersion = target.versions.length - 1;
            Object.assign(target, target.versions[target.activeVersion]);
            target.isStreaming = false;
            setBranchMessages(current, branchId, branchMessages);
          }
        } else {
          ensureBranches(current);
          const previousMessages = getBranchMessages(current, branchId) || [];
          const previousById = new Map(
            previousMessages.filter((message) => message.id).map((message) => [message.id, message])
          );
          const messagesWithHistory = generatedMessages.map((message, index) => {
            const previous =
              (message.id && previousById.get(message.id)) || previousMessages[index];
            if (!previous || previous.role !== message.role) return message;
            return {
              ...previous,
              ...message,
              ...(message.completedAt ? { isStreaming: false } : {}),
              createdAt: message.createdAt || previous.createdAt,
              startedAt: message.startedAt || previous.startedAt,
              completedAt: message.completedAt || previous.completedAt,
              durationMs: message.durationMs ?? previous.durationMs,
              toolEvents: message.toolEvents ?? previous.toolEvents,
              agentEvents: message.agentEvents ?? previous.agentEvents,
              usage: message.usage ?? previous.usage,
              usageByModel: message.usageByModel ?? previous.usageByModel,
              modelCallsByModel: message.modelCallsByModel ?? previous.modelCallsByModel,
              model: message.model ?? previous.model,
              modelMode: message.modelMode ?? previous.modelMode,
              routingDecision: message.routingDecision ?? previous.routingDecision,
              agentPlan: message.agentPlan ?? previous.agentPlan,
              versions: message.versions ?? previous.versions,
              activeVersion: message.activeVersion ?? previous.activeVersion,
            };
          });
          if (!setBranchMessages(current, branchId, messagesWithHistory))
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
          throw Object.assign(
            new Error(
              'Conversation changed while this response was generating. Refresh and retry.'
            ),
            { status: 409 }
          );
        }
        return saved;
      },
    });
    await persistenceQueue;
    await finishGenerationSession(generationId, ownerId, res.generationFinalStatus || 'completed');
  } catch (error) {
    const generationId = String(req.body?.generationId || '');
    if (generationId) await finishGenerationSession(generationId, String(req.user?._id || ''), 'failed', error.message).catch(() => {});
    next(error);
  }
});
router.post('/stream/:generationId/cancel', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || '');
    const generationId = String(req.params.generationId || '');
    const session = await getGenerationSession(generationId, ownerId);
    if (!session) return res.status(404).json({ error: 'Generation session not found.' });
    if (session.status !== 'running') return res.json({ cancelled: false, status: session.status });
    const stopRequested = requestStopChatGeneration(generationId, ownerId, 'user');
    if (!stopRequested) return res.status(409).json({ error: 'The generation is no longer active in this server process.', status: session.status });
    return res.json({ stopRequested: true, status: 'finishing_current_operation' });
  } catch (error) { next(error); }
});
router.get('/stream/:generationId/events', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || '');
    const generationId = String(req.params.generationId || '');
    const session = await getGenerationSession(generationId, ownerId);
    if (!session) return res.status(404).json({ error: 'Generation session not found.' });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let after = Math.max(0, Number(req.query.after) || 0);
    let closed = false;
    let lastHeartbeatAt = Date.now();
    res.on('close', () => { closed = true; });
    while (!closed) {
      const batch = await getGenerationEvents(generationId, ownerId, after);
      if (!batch) break;
      for (const event of batch.events) {
        after = Math.max(after, Number(event.eventId) || after);
        if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (Date.now() - lastHeartbeatAt >= 15000 && !res.destroyed && !res.writableEnded) { res.write(': keep-alive\n\n'); lastHeartbeatAt = Date.now(); }
      if (batch.status !== 'running') {
        if (!res.destroyed && !res.writableEnded) res.end();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (error) { next(error); }
});
router.post('/title', async (req, res, next) => {
  try {
    const title = await generateChatTitle(req.body?.text || '', req.user);
    res.json({ title });
  } catch (error) {
    next(error);
  }
});
export default router;
