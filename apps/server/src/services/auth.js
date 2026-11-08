import crypto from 'node:crypto';
import { User } from '../models/User.js';

const cookieName = 'nemotron_session';
const stateCookie = 'nemotron_oauth_state';
const secret = () => process.env.SESSION_SECRET || 'development-only-change-this-secret';
const b64 = (value) => Buffer.from(value).toString('base64url');
const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');
const cookieOptions = (maxAge) => `Path=/; HttpOnly; SameSite=${process.env.NODE_ENV === 'production' ? 'None' : 'Lax'}; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('='); return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
function signed(value) { return `${value}.${sign(value)}`; }
function verify(value) {
  if (!value) return null;
  const index = value.lastIndexOf('.'); if (index < 0) return null;
  const raw = value.slice(0, index); const signature = value.slice(index + 1);
  const expected = sign(raw);
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? raw : null; } catch { return null; }
}
function setCookie(res, name, value, maxAge) { res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; ${cookieOptions(maxAge)}`); }
function clearCookie(res, name) { res.append('Set-Cookie', `${name}=; ${cookieOptions(0)}`); }

export function createSessionCookie(res, userId) {
  const payload = b64(JSON.stringify({ sub: String(userId), exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  setCookie(res, cookieName, signed(payload), 60 * 60 * 24 * 30);
}
export function clearSessionCookie(res) { clearCookie(res, cookieName); }

export function sessionUserId(req) {
  const cookies = parseCookies(req.headers.cookie || ''); const raw = verify(cookies[cookieName]);
  if (!raw) return null; try { const payload = JSON.parse(Buffer.from(raw, 'base64url').toString()); return payload.exp > Date.now() ? String(payload.sub) : null; } catch { return null; }
}

export async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const raw = verify(cookies[cookieName]);
    if (raw) {
      const payload = JSON.parse(Buffer.from(raw, 'base64url').toString());
      if (payload.exp > Date.now()) {
        const user = await User.findById(payload.sub).lean();
        if (user) { req.user = user; return next(); }
      }
    }
    if (process.env.AUTH_REQUIRED === 'false' && process.env.NODE_ENV !== 'production') {
      req.user = { _id: `guest:${req.ip}`, name: 'Guest', preferences: {}, memories: [] };
      return next();
    }
    return res.status(401).json({ error: 'Authentication required.' });
  } catch (error) { return next(error); }
}

function providerConfig(provider) {
  const common = { google: 'GOOGLE', github: 'GITHUB', discord: 'DISCORD' }[provider];
  if (!common) throw new Error('Unsupported sign-in provider.');
  const get = key => process.env[`${common}_${key}`];
  const callback = get('CALLBACK_URL') || `${process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`}/api/auth/${provider}/callback`;
  if (provider === 'google') return { clientId: get('CLIENT_ID'), clientSecret: get('CLIENT_SECRET'), callback, auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token' };
  if (provider === 'github') return { clientId: get('CLIENT_ID'), clientSecret: get('CLIENT_SECRET'), callback, auth: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token' };
  return { clientId: get('CLIENT_ID'), clientSecret: get('CLIENT_SECRET'), callback, auth: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token' };
}

export function oauthStart(req, res, provider) {
  const config = providerConfig(provider);
  if (!config.clientId || !config.clientSecret) return res.status(503).send(`${provider} OAuth is not configured on the server.`);
  const state = crypto.randomBytes(24).toString('hex');
  const linkUserId = req.authLinkUserId || null;
  setCookie(res, stateCookie, signed(b64(JSON.stringify({ state, provider, linkUserId, exp: Date.now() + 10 * 60 * 1000 }))), 600);
  const url = new URL(config.auth);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callback);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (provider === 'google') url.searchParams.set('scope', 'openid email profile');
  if (provider === 'github') url.searchParams.set('scope', 'read:user user:email');
  if (provider === 'discord') url.searchParams.set('scope', 'identify email');
  res.redirect(url.toString());
}

async function exchangeToken(provider, config, code) {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.callback, grant_type: 'authorization_code' });
  const response = await fetch(config.token, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'OAuth token exchange failed.');
  return data.access_token;
}
async function fetchProfile(provider, token) {
  if (provider === 'google') {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Could not load Google profile.');
    const p = await response.json(); return { id: p.sub, name: p.name, email: p.email, emailVerified: p.email_verified === true, avatar: p.picture };
  }
  if (provider === 'github') {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Nemotron-Agent-Lab' };
    const [userRes, emailRes] = await Promise.all([fetch('https://api.github.com/user', { headers }), fetch('https://api.github.com/user/emails', { headers })]);
    if (!userRes.ok) throw new Error('Could not load GitHub profile.');
    const p = await userRes.json(); const emails = emailRes.ok ? await emailRes.json() : [];
    const primary = emails.find(x => x.primary && x.verified) || emails.find(x => x.verified); return { id: String(p.id), name: p.name || p.login, email: primary?.email || '', emailVerified: Boolean(primary?.verified), avatar: p.avatar_url };
  }
  const response = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Could not load Discord profile.');
  const p = await response.json();
  return { id: p.id, name: p.global_name || p.username, email: p.email || '', emailVerified: p.verified === true, avatar: p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png` : '' };
}

export async function oauthCallback(req, res, provider) {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  let linkAttempt = false;
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const raw = verify(cookies[stateCookie]);
    const statePayload = raw ? JSON.parse(Buffer.from(raw, 'base64url').toString()) : null;
    clearCookie(res, stateCookie);
    if (!statePayload || statePayload.provider !== provider || statePayload.state !== req.query.state || statePayload.exp < Date.now()) throw new Error('OAuth state validation failed. Please try signing in again.');
    if (req.query.error) throw new Error(String(req.query.error));
    const config = providerConfig(provider);
    const token = await exchangeToken(provider, config, String(req.query.code || ''));
    const profile = await fetchProfile(provider, token);
    const verifiedEmail = profile.emailVerified === true && Boolean(profile.email);
    const identity = { provider, providerId: String(profile.id), providerEmail: verifiedEmail ? profile.email.toLowerCase() : '' };

    if (statePayload.linkUserId) {
      linkAttempt = true;
      const activeUserId = sessionUserId(req);
      if (!activeUserId || activeUserId !== String(statePayload.linkUserId)) throw new Error('Your sign-in session changed. Sign in again before linking an account.');
      const existingIdentity = await User.findOne({ $or: [{ provider, providerId: identity.providerId }, { linkedAccounts: { $elemMatch: { provider, providerId: identity.providerId } } }] });
      if (existingIdentity && String(existingIdentity._id) !== activeUserId) throw new Error('This provider account is already linked to another user.');
      if (verifiedEmail) {
        const emailOwner = await User.findOne({ email: profile.email.toLowerCase(), emailVerified: true });
        if (emailOwner && String(emailOwner._id) !== activeUserId) throw new Error('This verified email belongs to another account. Sign in to that account to link providers.');
      }
      const user = await User.findById(activeUserId);
      if (!user) throw new Error('Account not found.');
      const linked = Array.isArray(user.linkedAccounts) ? user.linkedAccounts : [];
      const existingProviderLink = linked.find(item => item.provider === provider);
      if (existingProviderLink && existingProviderLink.providerId !== identity.providerId) throw new Error(`A different ${provider} account is already linked to this user.`);
      if (!linked.some(item => item.provider === provider && item.providerId === identity.providerId)) linked.push({ ...identity, linkedAt: new Date() });
      user.linkedAccounts = linked;
      if (!user.provider || !user.providerId) { user.provider = provider; user.providerId = identity.providerId; }
      await user.save();
      res.redirect(`${frontend}/?account_linked=${encodeURIComponent(provider)}`);
      return;
    }

    let user = await User.findOne({ $or: [{ provider, providerId: identity.providerId }, { linkedAccounts: { $elemMatch: { provider, providerId: identity.providerId } } }] });
    if (!user) {
      if (verifiedEmail) {
        const emailOwner = await User.findOne({ email: profile.email.toLowerCase(), emailVerified: true });
        if (emailOwner) throw new Error('An account already uses this verified email. Sign in with its linked provider, then link this provider in Settings.');
      }
      const base = String(profile.name || provider).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 15) || 'user';
      let username = `${base}_${crypto.randomBytes(3).toString('hex')}`;
      user = await User.create({ provider, providerId: identity.providerId, linkedAccounts: [{ ...identity, linkedAt: new Date() }], name: profile.name || 'User', email: verifiedEmail ? profile.email.toLowerCase() : '', emailVerified: verifiedEmail, avatar: profile.avatar || '', username, lastLoginAt: new Date() });
    } else {
      const linked = Array.isArray(user.linkedAccounts) ? user.linkedAccounts : [];
      if (!linked.some(item => item.provider === provider && item.providerId === identity.providerId)) linked.push({ ...identity, linkedAt: new Date() });
      user.linkedAccounts = linked;
      if (!user.provider || !user.providerId) { user.provider = provider; user.providerId = identity.providerId; }
      user.name = profile.name || user.name; user.avatar = profile.avatar || user.avatar; user.lastLoginAt = new Date();
      if (verifiedEmail) { const owner = await User.findOne({ email: profile.email.toLowerCase(), emailVerified: true, _id: { $ne: user._id } }); if (!owner) { user.email = profile.email.toLowerCase(); user.emailVerified = true; } }
      await user.save();
    }
    createSessionCookie(res, user._id);
    res.redirect(frontend);
  } catch (error) {
    const key = linkAttempt ? 'account_link_error' : 'auth_error';
    res.redirect(`${frontend}/?${key}=${encodeURIComponent(error.message || 'Sign-in failed')}`);
  }
}

export async function currentUser(req, res) {
  if (!req.user) return res.json({ user: null });
  const user = req.user._id.toString().startsWith('guest:') ? req.user : await User.findById(req.user._id).select('-memories').lean();
  res.json({ user });
}
