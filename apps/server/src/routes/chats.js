import { Router } from 'express';
import { createChat, deleteChat, getChat, listChats, updateChat } from '../services/chatStore.js';
const router = Router();
function owner(req) { return String(req.user?._id || ''); }
router.get('/', async (req, res, next) => { try { res.json({ chats: await listChats(owner(req)) }); } catch (error) { next(error); } });
router.post('/', async (req, res, next) => { try { res.status(201).json({ chat: await createChat(owner(req), req.body?.title) }); } catch (error) { next(error); } });
router.get('/:id', async (req, res, next) => { try { const chat = await getChat(owner(req), req.params.id); if (!chat) return res.status(404).json({ error: 'Chat not found.' }); res.json({ chat }); } catch (error) { next(error); } });
router.patch('/:id', async (req, res, next) => { try { const patch = {}; if (typeof req.body?.title === 'string') patch.title = req.body.title; if (Array.isArray(req.body?.messages)) patch.messages = req.body.messages; const chat = await updateChat(owner(req), req.params.id, patch); if (!chat) return res.status(404).json({ error: 'Chat not found.' }); res.json({ chat }); } catch (error) { next(error); } });
router.delete('/:id', async (req, res, next) => { try { const deleted = await deleteChat(owner(req), req.params.id); if (!deleted) return res.status(404).json({ error: 'Chat not found.' }); res.json({ ok: true }); } catch (error) { next(error); } });
export default router;
