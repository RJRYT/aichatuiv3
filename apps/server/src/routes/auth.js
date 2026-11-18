import { Router } from 'express';
import {
  clearSessionCookie,
  currentUser,
  oauthCallback,
  oauthStart,
  optionalAuth,
  requireAuth,
} from '../services/auth.js';
import logger from '../utils/logger.js';

const router = Router();
const log = logger.child({ component: 'routes:auth' });
for (const provider of ['google', 'github', 'discord']) {
  router.get(`/${provider}`, (req, res) => {
    oauthStart(req, res, provider);
  });
  router.get(`/${provider}/callback`, (req, res, next) => {
    oauthCallback(req, res, provider).catch(next);
  });
  router.get(`/${provider}/link`, requireAuth, (req, res) => {
    req.authLinkUserId = String(req.user._id);
    oauthStart(req, res, provider);
  });
}
router.get('/me', optionalAuth, (req, res, next) => {
  currentUser(req, res).catch(next);
});
router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
export default router;
