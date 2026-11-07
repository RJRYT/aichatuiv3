import { Router } from 'express';
import crypto from 'node:crypto';
import { Share } from '../models/Share.js';
import { getChat } from '../services/chatStore.js';
import { ensureBranches, getBranchMessages } from '../services/conversationBranches.js';
const router = Router();
const owner = req => String(req.user?._id || '');
router.get('/', async (req, res, next) => { try { const shares = await Share.find({ ownerId: owner(req), revokedAt: null }).select('shareId title chatId createdAt').sort({ createdAt: -1 }).lean(); res.json({ shares }); } catch (error) { next(error); } });
router.post('/', async (req, res, next) => {
  try {
    const { chatId, branchId, messageId, includeContext = false } = req.body || {};
    if (!chatId || !messageId) return res.status(400).json({ error: 'chatId and messageId are required.' });
    const chat = await getChat(owner(req), String(chatId));
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(chat);
    const messages = getBranchMessages(chat, branchId || chat.activeBranchId);
    const index = messages?.findIndex(m => m.id === messageId) ?? -1;
    if (index < 0 || messages[index].role !== 'assistant') return res.status(404).json({ error: 'Assistant response not found.' });
    const selected = messages[index];
    const safeMessage = { role: 'assistant', content: typeof selected.content === 'string' ? selected.content : '', createdAt: selected.createdAt };
    const snapshot = includeContext && index > 0 ? [messages[index - 1], safeMessage].map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '[Attachment]' })) : [safeMessage];
    const share = await Share.create({ shareId: crypto.randomBytes(18).toString('base64url'), ownerId: owner(req), chatId: String(chatId), title: chat.title || 'Shared response', messages: snapshot });
    res.status(201).json({ shareId: share.shareId, url: `${String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/share/${share.shareId}` });
  } catch (error) { next(error); }
});
router.delete('/:shareId', async (req, res, next) => {
  try {
    const share = await Share.findOneAndUpdate({ shareId: req.params.shareId, ownerId: owner(req), revokedAt: null }, { $set: { revokedAt: new Date() } }, { new: true });
    if (!share) return res.status(404).json({ error: 'Active share not found.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
export default router;
