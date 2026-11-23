import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import logger from '../utils/logger.js';
import { encryptCredentials, decryptCredentials, maskSecret } from '../services/integrations/crypto.js';
import { isToolUserConfigurable } from '../services/toolPolicy.js';

const router = Router();
const integrationTestLimiter = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many integration tests. Please wait a minute and try again.' } });
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
  activeModel: 'auto',
  persona: 'agent',
  personaInstructions: '',
  personality: { professionalism: 80, friendliness: 75, humor: 35, directness: 75, explanatoryDepth: 65, criticalThinking: 90, creativity: 70, confidence: 80, curiosity: 75, analyticalDepth: 85, autonomy: 75, initiative: 80, empathy: 70, thoroughness: 85, riskTolerance: 35, intensity: 70 },
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
      .select('-memories -integrations')
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
  const user = await User.findById(req.user._id).select('-memories -integrations').lean();
  res.json({ user });
});
router.get('/preferences', async (req, res) => {
  if (guest(req)) return res.json({ preferences: { ...defaults, personality: { ...defaults.personality } } });
  const user = await User.findById(req.user._id).select('preferences').lean();
  res.json({ preferences: { ...defaults, ...(user?.preferences || {}), personality: { ...defaults.personality, ...(user?.preferences?.personality || {}) } } });
});
router.get('/memories', async (req, res) => {
  if (guest(req)) return res.json({ memories: [] });
  const user = await User.findById(req.user._id).select('memories').lean();
  res.json({ memories: user?.memories || [] });
});
router.patch('/preferences', async (req, res) => {
  const userId = String(req.user._id);
  const next = {};
  for (const key of Object.keys(defaults)) {
    if (req.body?.[key] === undefined) continue;
    const value = req.body[key];
    if (key === 'activeModel' && !['auto', 'bolt', 'vision', 'surge', 'titan', 'omni'].includes(String(value))) continue;
    if (key === 'persona' && !['agent', 'engineer', 'mentor', 'researcher', 'concise', 'creative'].includes(String(value))) continue;
    if (key === 'personaInstructions') {
      if (typeof value !== 'string') continue;
      next['preferences.personaInstructions'] = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 1600);
      continue;
    }
    if (key === 'personality') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const [dimension, raw] of Object.entries(value)) {
        if (!Object.hasOwn(defaults.personality, dimension)) continue;
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) continue;
        next[`preferences.personality.${dimension}`] = Math.max(0, Math.min(100, Math.round(numeric / 5) * 5));
      }
      continue;
    }
    if (key === 'warmth' || key === 'enthusiasm') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) continue;
      next[`preferences.${key}`] = numeric;
      continue;
    }
    if (['visualAnswers', 'headers', 'lists'].includes(key)) {
      if (typeof value !== 'boolean') continue;
    }
    if (['baseStyle', 'tone', 'emoji'].includes(key) && typeof value !== 'string') continue;
    next[`preferences.${key}`] = value;
  }
  if (guest(req)) {
    const guestPreferences = { ...defaults, personality: { ...defaults.personality } };
    for (const [path, value] of Object.entries(next)) {
      const parts = path.replace(/^preferences\./, '').split('.');
      if (parts[0] === 'personality' && parts[1]) guestPreferences.personality[parts[1]] = value;
      else guestPreferences[parts[0]] = value;
    }
    return res.json({ preferences: guestPreferences });
  }
  const user = await User.findByIdAndUpdate(req.user._id, { $set: next }, { new: true })
    .select('preferences')
    .lean();
  res.json({ preferences: { ...defaults, ...user.preferences, personality: { ...defaults.personality, ...(user.preferences?.personality || {}) } } });
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
      if (typeof value === 'boolean' && isToolUserConfigurable(key)) patch[`pluginPermissions.${key}`] = value;
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

const integrationFields = {
  nvidia: ['apiKey'],
  tavily: ['apiKey'],
  cloudflare: ['accountId', 'apiToken'],
  vercel: ['token', 'teamId', 'projectId'],
};
function integrationStatus(provider, credentials = {}) {
  const masked = {};
  for (const field of integrationFields[provider] || []) masked[field] = credentials[field] ? maskSecret(credentials[field]) : '';
  return { configured: Object.values(credentials).some(Boolean), fields: masked };
}
router.get('/integrations', async (req, res) => {
  if (guest(req)) return res.json({ integrations: {} });
  const user = await User.findById(req.user._id).select('integrations').lean();
  const integrations = {};
  for (const provider of Object.keys(integrationFields)) {
    let credentials = {};
    let decryptionError = false;
    try { credentials = decryptCredentials(user?.integrations?.[provider]); } catch { decryptionError = true; }
    integrations[provider] = { ...integrationStatus(provider, credentials), ...(decryptionError ? { error: 'Credentials cannot be decrypted. Re-enter them.' } : {}) };
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ integrations });
});
router.put('/integrations/:provider', async (req, res, next) => {
  try {
    if (guest(req)) return res.status(403).json({ error: 'Sign in to configure personal integrations.' });
    const provider = String(req.params.provider || '').toLowerCase();
    const allowed = integrationFields[provider];
    if (!allowed) return res.status(404).json({ error: 'Unknown integration.' });
    let existing = {};
    try { existing = decryptCredentials(req.user?.integrations?.[provider]); } catch {}
    const credentials = { ...existing };
    for (const field of allowed) {
      const value = String(req.body?.[field] || '').trim();
      if (value.length > 4096) return res.status(400).json({ error: `${field} is too long.` });
      if (value) credentials[field] = value;
    }
    const required = provider === 'cloudflare' ? ['accountId', 'apiToken'] : provider === 'vercel' ? ['token', 'teamId', 'projectId'] : ['apiKey'];
    if (required.some((field) => !credentials[field])) return res.status(400).json({ error: `Required fields: ${required.join(', ')}.` });
    const encrypted = encryptCredentials(credentials);
    await User.updateOne({ _id: req.user._id }, { $set: { [`integrations.${provider}`]: encrypted } });
    res.json({ provider, status: integrationStatus(provider, credentials) });
  } catch (error) { next(error); }
});
router.delete('/integrations/:provider', async (req, res) => {
  if (guest(req)) return res.status(403).json({ error: 'Sign in to manage personal integrations.' });
  const provider = String(req.params.provider || '').toLowerCase();
  if (!integrationFields[provider]) return res.status(404).json({ error: 'Unknown integration.' });
  await User.updateOne({ _id: req.user._id }, { $unset: { [`integrations.${provider}`]: '' } });
  res.json({ provider, removed: true });
});
router.post('/integrations/:provider/test', integrationTestLimiter, async (req, res) => {
  if (guest(req)) return res.status(403).json({ error: 'Sign in to test personal integrations.' });
  const provider = String(req.params.provider || '').toLowerCase();
  if (!integrationFields[provider]) return res.status(404).json({ error: 'Unknown integration.' });
  const user = await User.findById(req.user._id).select('integrations').lean();
  let credentials = {};
  try { credentials = decryptCredentials(user?.integrations?.[provider]); } catch { return res.status(400).json({ ok: false, error: 'Stored credentials could not be decrypted. Re-enter them.' }); }
  const required = provider === 'cloudflare' ? ['accountId', 'apiToken'] : provider === 'vercel' ? ['token', 'teamId', 'projectId'] : ['apiKey'];
  if (required.some((field) => !credentials[field])) return res.status(400).json({ ok: false, error: 'Save complete credentials before testing this integration.' });
  try {
    let response;
    if (provider === 'nvidia') {
      response = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: `Bearer ${credentials.apiKey}` }, signal: AbortSignal.timeout(12000) });
    } else if (provider === 'tavily') {
      response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: credentials.apiKey, query: 'Nemotron Agent Lab connection test', max_results: 1 }), signal: AbortSignal.timeout(12000) });
    } else if (provider === 'cloudflare') {
      response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${credentials.apiToken}` }, signal: AbortSignal.timeout(12000) });
    } else {
      response = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(credentials.projectId)}?teamId=${encodeURIComponent(credentials.teamId)}`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(12000) });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) return res.status(400).json({ ok: false, error: `Connection failed (HTTP ${response.status}). Check the credential and required permissions.` });
    res.json({ ok: true, message: `${provider} connection verified.` });
  } catch (error) { res.status(400).json({ ok: false, error: error.name === 'TimeoutError' ? 'Connection test timed out.' : 'Connection test failed. Check credentials and network access.' }); }
});

export default router;
