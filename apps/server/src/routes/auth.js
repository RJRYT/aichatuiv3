import { Router } from 'express';
import { clearSessionCookie, currentUser, oauthCallback, oauthStart, requireAuth } from '../services/auth.js';
const router = Router();
for (const provider of ['google', 'github', 'discord']) {
  router.get(`/${provider}`, (req, res) => oauthStart(req, res, provider));
  router.get(`/${provider}/callback`, (req, res, next) => oauthCallback(req, res, provider).catch(next));
}
router.get('/me', requireAuth, currentUser);
router.post('/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
export default router;
