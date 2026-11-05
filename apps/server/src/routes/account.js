import { Router } from 'express';
import { User } from '../models/User.js';
const router = Router();
const defaults = { baseStyle: 'friendly', tone: 'balanced', warmth: 3, enthusiasm: 3, emoji: 'moderate', visualAnswers: true, headers: true, lists: true };
function guest(req) { return String(req.user?._id || '').startsWith('guest:'); }
router.get('/preferences', async (req, res) => {
  const preferences = guest(req) ? { ...defaults } : (await User.findById(req.user._id).select('preferences').lean())?.preferences || defaults;
  res.json({ preferences: { ...defaults, ...preferences } });
});
router.patch('/preferences', async (req, res) => {
  const next = {};
  for (const key of Object.keys(defaults)) if (req.body?.[key] !== undefined) next[`preferences.${key}`] = req.body[key];
  if (guest(req)) return res.json({ preferences: { ...defaults, ...req.body } });
  const user = await User.findByIdAndUpdate(req.user._id, { $set: next }, { new: true }).select('preferences').lean();
  res.json({ preferences: { ...defaults, ...user.preferences } });
});
router.get('/memories', async (req, res) => {
  if (guest(req)) return res.json({ memories: [] });
  const user = await User.findById(req.user._id).select('memories').lean(); res.json({ memories: user?.memories || [] });
});
router.post('/memories', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Memory must be between 1 and 2,000 characters.' });
  if (guest(req)) return res.status(403).json({ error: 'Sign in to save memories.' });
  const user = await User.findByIdAndUpdate(req.user._id, { $push: { memories: { text, source: 'user' } } }, { new: true }).select('memories').lean();
  res.status(201).json({ memories: user.memories });
});
router.patch('/memories/:id', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Memory must be between 1 and 2,000 characters.' });
  if (guest(req)) return res.status(403).json({ error: 'Sign in to manage memories.' });
  const user = await User.findOneAndUpdate({ _id: req.user._id, 'memories._id': req.params.id }, { $set: { 'memories.$.text': text } }, { new: true }).select('memories').lean();
  if (!user) return res.status(404).json({ error: 'Memory not found.' }); res.json({ memories: user.memories });
});
router.delete('/memories/:id', async (req, res) => {
  if (guest(req)) return res.status(403).json({ error: 'Sign in to manage memories.' });
  const user = await User.findByIdAndUpdate(req.user._id, { $pull: { memories: { _id: req.params.id } } }, { new: true }).select('memories').lean();
  res.json({ memories: user?.memories || [] });
});
export default router;
