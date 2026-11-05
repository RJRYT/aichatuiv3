import { Router } from 'express';
import { runNemotronChat, generateChatTitle } from '../services/nvidia.js';
import { getChat, updateChat } from '../services/chatStore.js';
const router = Router();
router.post('/stream', async (req, res, next) => {
  try {
    const ownerId = String(req.user?._id || ''); const chatId = String(req.body?.chatId || '');
    if (!ownerId || !chatId) return res.status(400).json({ error: 'Chat ID is required.' });
    const existing = await getChat(ownerId, chatId);
    if (!existing) return res.status(404).json({ error: 'Chat not found.' });
    if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    res.status(200); res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.();
    await runNemotronChat({ body: req.body, req, res, user: req.user, persist: async messages => updateChat(ownerId, chatId, { messages }) });
  } catch (error) { next(error); }
});
router.post('/title', async (req, res, next) => {
  try {
    if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: 'NVIDIA_API_KEY is missing on the backend.' });
    const title = await generateChatTitle(req.body?.text || ''); res.json({ title });
  } catch (error) { next(error); }
});
export default router;
