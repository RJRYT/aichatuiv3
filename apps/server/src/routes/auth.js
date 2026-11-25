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
const performLogout = (_req, res) => {
  clearSessionCookie(res);
  res.append('Set-Cookie', `${'nemotron_oauth_state'}=; Path=/; HttpOnly; SameSite=${String(process.env.SESSION_COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'))}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.NODE_ENV === 'production' ? '; Secure' : ''}${process.env.SESSION_COOKIE_DOMAIN ? `; Domain=${process.env.SESSION_COOKIE_DOMAIN}` : ''}`);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
};
router.post('/logout', performLogout);
router.get('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.append('Set-Cookie', `nemotron_oauth_state=; Path=/; HttpOnly; SameSite=${String(process.env.SESSION_COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'))}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.NODE_ENV === 'production' ? '; Secure' : ''}${process.env.SESSION_COOKIE_DOMAIN ? `; Domain=${process.env.SESSION_COOKIE_DOMAIN}` : ''}`);
  res.set('Cache-Control', 'no-store');
  res.redirect(303, process.env.FRONTEND_URL || '/');
});
export default router;
