import { Router } from 'express';
import { runNemotronChat, generateChatTitle } from '../services/nvidia.js';
import { getChat, updateChat } from '../services/chatStore.js';
import { ensureBranches, getBranchMessages, setBranchMessages } from '../services/conversationBranches.js';
const router = Router();
router.post('/stream', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || ''); const chatId = String(req.body?.chatId || '');
    if (!ownerId || !chatId) return res.status(400).json({ error: 'Chat ID is required.' });
    if (!Array.isArray(req.body?.messages) || !req.body.messages.length || req.body.messages.length > 300) return res.status(400).json({ error: 'Provide between 1 and 300 conversation messages.' });
    for (const message of req.body.messages) {
      if (!message || !['user', 'assistant'].includes(message.role) || message.tool_calls || message.tool_call_id || message.name) return res.status(400).json({ error: 'Only plain user and assistant messages are accepted from the client.' });
      if (typeof message.content === 'string') { if (message.content.length > 120000) return res.status(413).json({ error: 'A message exceeds the 120,000 character limit.' }); }
      else if (Array.isArray(message.content)) { if (message.content.length > 100 || message.content.some(part => !part || (part.type === 'text' ? typeof part.text !== 'string' || part.text.length > 20000 : part.type === 'image_url' ? typeof part.image_url?.url !== 'string' || !part.image_url.url.startsWith('data:image/') || part.image_url.url.length > 22 * 1024 * 1024 : true))) return res.status(400).json({ error: 'Unsupported or oversized multimodal message content.' }); }
      else return res.status(400).json({ error: 'Message content must be text or supported image parts.' });
    }
    const existing = await getChat(ownerId, chatId);
    if (!existing) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(existing); const requestedBranchId = String(req.body?.branchId || existing.activeBranchId || 'main');
    if (!getBranchMessages(existing, requestedBranchId)) return res.status(404).json({ error: 'Conversation branch not found.' });
    if (req.body?.preserveExistingMessageId && !getBranchMessages(existing, requestedBranchId).some(message => message.id === req.body.preserveExistingMessageId)) return res.status(404).json({ error: 'Response to regenerate was not found in this branch.' });
    if (Number.isInteger(req.body?.expectedRevision) && req.body.expectedRevision !== (existing.revision || 0)) return res.status(409).json({ error: 'This conversation changed elsewhere. Refresh before generating.' });
    if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    res.status(200); res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.();
    await runNemotronChat({ body: req.body, req, res, user: req.user, persist: async generatedMessages => {
      const current = await getChat(ownerId, chatId); if (!current) return; ensureBranches(current);
      const branchId = String(req.body.branchId || current.activeBranchId || 'main');
      if (req.body.preserveExistingMessageId) {
        const branchMessages = getBranchMessages(current, branchId); const target = branchMessages?.find(m => m.id === req.body.preserveExistingMessageId); const alternative = generatedMessages[generatedMessages.length - 1];
        if (!target || !alternative) throw Object.assign(new Error('The response version target is no longer available.'), { status: 409 });
        if (target && alternative) { target.versions = Array.isArray(target.versions) ? target.versions : [{ content: target.content, reasoning: target.reasoning, toolEvents: target.toolEvents, usage: target.usage, createdAt: target.createdAt }]; target.versions.push({ content: alternative.content, reasoning: alternative.reasoning, toolEvents: alternative.toolEvents, usage: alternative.usage, createdAt: alternative.createdAt }); target.activeVersion = target.versions.length - 1; Object.assign(target, target.versions[target.activeVersion]); setBranchMessages(current, branchId, branchMessages);
        }
      } else { ensureBranches(current); if (!setBranchMessages(current, branchId, generatedMessages)) throw Object.assign(new Error('Conversation branch no longer exists.'), { status: 409 }); }
      const saved = await updateChat(ownerId, chatId, { branches: current.branches, messages: current.messages, activeBranchId: branchId, revision: (current.revision || 0) + 1, expectedRevision: req.body.expectedRevision ?? (existing.revision || 0) });
      if (!saved) throw Object.assign(new Error('Conversation changed while this response was generating. Refresh and retry.'), { status: 409 });
      return saved;
    } });
  } catch (error) { next(error); }
});
router.post('/title', async (req, res, next) => {
  try {
    if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    const title = await generateChatTitle(req.body?.text || ''); res.json({ title });
  } catch (error) { next(error); }
});
export default router;
