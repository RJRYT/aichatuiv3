import { Router } from 'express';
import { User } from '../models/User.js';
import logger from '../utils/logger.js';

const router = Router();
const log = logger.child({ component: 'routes:account' });
const reservedUsernames = new Set([
  'admin',
  'administrator',
  'api',
  'support',
  'help',
  'root',
  'system',
  'nemotron',
  'nemotronagent',
  'agent',
  'null',
  'undefined',
]);
const usernamePattern = /^[a-z0-9_]{3,24}$/;
const defaults = {
  baseStyle: 'friendly',
  tone: 'balanced',
  warmth: 3,
  enthusiasm: 3,
  emoji: 'moderate',
  visualAnswers: true,
  headers: true,
  lists: true,
};
function guest(req) {
  return String(req.user?._id || '').startsWith('guest:');
}
router.get('/profile/username-availability', async (req, res) => {
  if (guest(req)) return res.json({ available: false, reason: 'Sign in to choose a username.' });
  const username = String(req.query.username || '')
    .trim()
    .toLowerCase();
  if (!usernamePattern.test(username) || reservedUsernames.has(username))
    return res.json({
      available: false,
      reason: 'Use 3–24 letters, numbers or underscores; this username is unavailable.',
    });
  const exists = await User.exists({ username, _id: { $ne: req.user._id } });
  res.json({ available: !exists });
});
router.patch('/profile', async (req, res, next) => {
  const userId = String(req.user._id);
  if (guest(req)) return res.status(403).json({ error: 'Sign in to edit your profile.' });
  const name = req.body?.name === undefined ? undefined : String(req.body.name).trim();
  const username =
    req.body?.username === undefined ? undefined : String(req.body.username).trim().toLowerCase();
  if (name !== undefined && (!name || name.length > 80))
    return res.status(400).json({ error: 'Display name must be 1–80 characters.' });
  if (
    username !== undefined &&
    (!usernamePattern.test(username) || reservedUsernames.has(username))
  )
    return res
      .status(400)
      .json({ error: 'Username must be 3–24 characters using letters, numbers or underscores.' });
  const set = {};
  if (name !== undefined) set.name = name;
  if (username !== undefined) set.username = username;
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: set },
      { new: true, runValidators: true }
    )
      .select('-memories')
      .lean();
    res.json({ user });
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ error: 'That username is already taken.' });
    return next(error);
  }
});
router.get('/profile', async (req, res) => {
  if (guest(req)) return res.json({ user: req.user });
  const user = await User.findById(req.user._id).select('-memories').lean();
  res.json({ user });
});
router.get('/preferences', async (req, res) => {
  if (guest(req)) return res.json({ preferences: { ...defaults } });
  const user = await User.findById(req.user._id).select('preferences').lean();
  res.json({ preferences: { ...defaults, ...(user?.preferences || {}) } });
});
router.get('/memories', async (req, res) => {
  if (guest(req)) return res.json({ memories: [] });
  const user = await User.findById(req.user._id).select('memories').lean();
  res.json({ memories: user?.memories || [] });
});
router.patch('/preferences', async (req, res) => {
  const userId = String(req.user._id);
  const next = {};
  for (const key of Object.keys(defaults))
    if (req.body?.[key] !== undefined) next[`preferences.${key}`] = req.body[key];
  if (guest(req)) return res.json({ preferences: { ...defaults, ...req.body } });
  const user = await User.findByIdAndUpdate(req.user._id, { $set: next }, { new: true })
    .select('preferences')
    .lean();
  res.json({ preferences: { ...defaults, ...user.preferences } });
});
router.post('/memories', async (req, res) => {
  const userId = String(req.user._id);
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 2000)
    return res.status(400).json({ error: 'Memory must be between 1 and 2,000 characters.' });
  if (guest(req)) return res.status(403).json({ error: 'Sign in to save memories.' });
  let user = await User.findOneAndUpdate(
    { _id: req.user._id, 'memories.text': { $ne: text } },
    { $push: { memories: { $each: [{ text, source: 'user' }], $slice: -50 } } },
    { new: true }
  )
    .select('memories')
    .lean();
  if (!user) user = await User.findById(req.user._id).select('memories').lean();
  res.status(200).json({ memories: user?.memories || [] });
});
router.patch('/memories/:id', async (req, res) => {
  const userId = String(req.user._id);
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 2000)
    return res.status(400).json({ error: 'Memory must be between 1 and 2,000 characters.' });
  if (guest(req)) return res.status(403).json({ error: 'Sign in to manage memories.' });
  const user = await User.findOneAndUpdate(
    { _id: req.user._id, 'memories._id': req.params.id },
    { $set: { 'memories.$.text': text } },
    { new: true }
  )
    .select('memories')
    .lean();
  if (!user) {
    return res.status(404).json({ error: 'Memory not found.' });
  }
  res.json({ memories: user.memories });
});
router.delete('/memories/:id', async (req, res) => {
  const userId = String(req.user._id);
  if (guest(req)) return res.status(403).json({ error: 'Sign in to manage memories.' });
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $pull: { memories: { _id: req.params.id } } },
    { new: true }
  )
    .select('memories')
    .lean();
  res.json({ memories: user?.memories || [] });
});

router.get('/plugins', async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('pluginPermissions customTools')
    .lean();
  res.json({
    permissions: user?.pluginPermissions || {},
    customTools: (user?.customTools || []).map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      url: tool.url,
      method: tool.method,
      parameters: tool.parameters || [],
    })),
  });
});

router.patch('/plugins', async (req, res, next) => {
  try {
    if (guest(req)) return res.status(403).json({ error: 'Sign in to manage plugins.' });
    const permissions = req.body?.permissions;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions))
      return res.status(400).json({ error: 'permissions must be an object.' });
    const patch = {};
    for (const [key, value] of Object.entries(permissions)) {
      if (typeof value === 'boolean') patch[`pluginPermissions.${key}`] = value;
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: patch },
      { new: true }
    )
      .select('pluginPermissions')
      .lean();
    res.json({ permissions: user?.pluginPermissions || {} });
  } catch (error) {
    next(error);
  }
});

router.post('/plugins/custom-tools', async (req, res, next) => {
  try {
    if (guest(req)) return res.status(403).json({ error: 'Sign in to add custom tools.' });
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const url = String(req.body?.url || '').trim();
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });
    if (!/^https:\/\/[\w.-]+/.test(url))
      return res.status(400).json({ error: 'Tool URL must be a public https:// endpoint.' });
    const id = `t${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const tool = {
      id,
      name,
      description: String(req.body?.description || '').trim().slice(0, 400),
      url,
      method: req.body?.method === 'GET' ? 'GET' : 'POST',
      parameters: Array.isArray(req.body?.parameters)
        ? req.body.parameters.slice(0, 10).map((param) => ({
            name: String(param?.name || '').replace(/[^\w-]/g, '').slice(0, 40),
            type: ['string', 'number', 'boolean'].includes(param?.type) ? param.type : 'string',
            description: String(param?.description || '').slice(0, 200),
            required: Boolean(param?.required),
          }))
        : [],
    };
    if (!tool.parameters.some((param) => param.name))
      return res.status(400).json({ error: 'At least one named parameter is required.' });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $push: { customTools: tool } },
      { new: true }
    )
      .select('customTools')
      .lean();
    res.json({ customTools: user?.customTools || [] });
  } catch (error) {
    next(error);
  }
});

router.delete('/plugins/custom-tools/:id', async (req, res, next) => {
  try {
    if (guest(req)) return res.status(403).json({ error: 'Sign in to manage custom tools.' });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { customTools: { id: req.params.id } } },
      { new: true }
    )
      .select('customTools')
      .lean();
    res.json({ customTools: user?.customTools || [] });
  } catch (error) {
    next(error);
  }
});
export default router;
