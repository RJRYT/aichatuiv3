import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { connectDatabase, getDatabaseMode } from './config/db.js';
import chatsRouter from './routes/chats.js';
import chatRouter from './routes/chat.js';
import authRouter from './routes/auth.js';
import accountRouter from './routes/account.js';
import interpreterRouter from './routes/interpreter.js';
import sharesRouter from './routes/shares.js';
import publicShareRouter from './routes/publicShare.js';
import { requireAuth } from './services/auth.js';
import { getPluginCatalog } from './services/tools.js';
import { MODEL_ID } from './services/nvidia.js';
import { closeSandboxManager } from './services/interpreter/sandboxManager.js';
import logger from './utils/logger.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });
const app = express();
const port = Number(process.env.PORT || 4000);
const log = logger.child({ component: 'server' });
app.use(logger.requestLogger());
const frontendDist = path.resolve(__dirname, '../../client/dist');
const allowedOrigins = String(
  process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedOrigins.includes('*'))
  throw new Error('CORS_ORIGIN must list explicit trusted origins in production; wildcard origins cannot be used with credentialed sessions.');
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin))
        return callback(null, true);
      if (
        process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      )
        return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: '28mb' }));
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait and retry.' },
});
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    database: getDatabaseMode(),
    authRequired: process.env.AUTH_REQUIRED !== 'false',
    oauth: {
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    },
  });
});
app.use('/api/auth', authRouter);
app.use('/api/public/shares', limiter, publicShareRouter);
app.use('/api', (req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('Origin');
  if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin))
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  return next();
});
app.use('/api', requireAuth);
app.use('/api/account', accountRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/interpreter', limiter, interpreterRouter);
app.get('/api/plugins', (_req, res) => res.json({ plugins: getPluginCatalog() }));
app.use('/api/chats', limiter, chatsRouter);
app.use('/api/chat', limiter, chatRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
if (process.env.SERVE_STATIC !== 'false' && fs.existsSync(frontendDist)) {
  app.use(
    express.static(frontendDist, {
      maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
      immutable: process.env.NODE_ENV === 'production',
    })
  );
  app.get('*', (req, res, next) =>
    req.path.startsWith('/api/') ? next() : res.sendFile(path.join(frontendDist, 'index.html'))
  );
}
app.use((error, _req, res, _next) => {
  logger.error('Unhandled request error', {
    error:
      error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : String(error),
  });
  if (res.headersSent) return res.end();
  res
    .status(Number(error.status) || (error.message?.includes('CORS') ? 403 : 500))
    .json({ error: error.message || 'Internal server error.' });
});
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32 ||
    process.env.SESSION_SECRET === 'development-only-change-this-secret' ||
    process.env.SESSION_SECRET.startsWith('replace-'))
) {
  log.warn('Weak or default SESSION_SECRET detected in production.');
  throw new Error('Set a unique SESSION_SECRET of at least 32 characters in production.');
}
await connectDatabase();
log.info('Nemotron Agent Lab API starting', { port, model: MODEL_ID, database: getDatabaseMode() });
const httpServer = app.listen(port, () =>
  log.info(`Nemotron Agent Lab API listening on http://localhost:${port}`, {
    model: MODEL_ID,
    database: getDatabaseMode(),
  })
);
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received; closing HTTP server and Python execution manager...`);
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown deadline exceeded.');
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  await closeSandboxManager();
  httpServer.close(async () => {
    clearTimeout(forceExit);
    process.exitCode = 0;
  });
}
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
