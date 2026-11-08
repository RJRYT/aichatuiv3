import { Router } from 'express';
import { executePython, cancelExecution } from '../services/interpreter/interpreter.js';
import { getArtifact, listArtifacts, deleteArtifact } from '../services/interpreter/artifactStore.js';
import { getChat } from '../services/chatStore.js';
import { getInterpreterStatus } from '../services/interpreter/sandboxManager.js';
import logger from '../utils/logger.js';

const router = Router();
const owner = req => String(req.user?._id || '');
const log = logger.child({ component: 'routes:interpreter' });

router.get('/status', (_req, res) => {
  log.debug('Interpreter status requested');
  res.json({ interpreter: getInterpreterStatus() });
});

router.post('/execute', async (req, res, next) => {
  try {
    if (!owner(req) || owner(req).startsWith('guest:')) {
      log.warn('Python execution denied: not signed in', { ip: req.ip });
      return res.status(401).json({ error: 'A signed-in account is required for Python execution.' });
    }
    if (req.body?.chatId) {
      const chat = await getChat(owner(req), String(req.body.chatId));
      if (!chat) return res.status(404).json({ error: 'Conversation not found.' });
    }
    log.info('Python execution started', { userId: owner(req) });
    const controller = new AbortController();
    const abortOnDisconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on('aborted', abortOnDisconnect);
    res.on('close', abortOnDisconnect);
    let result;
    try {
      result = await executePython(req.body, owner(req), { signal: controller.signal });
    } finally {
      req.off('aborted', abortOnDisconnect);
      res.off('close', abortOnDisconnect);
    }
    if (res.destroyed) return;
    const statusCode = result.status === 'completed' ? 200
      : result.status === 'timeout' ? 408
      : result.status === 'cancelled' ? 409
      : 422;
    log.info('Python execution completed', { userId: owner(req), status: result.status, durationMs: result.durationMs });
    return res.status(statusCode).json(result);
  } catch (error) {
    log.error('Python execution failed', { userId: owner(req), error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
});

router.post('/cancel/:id', (req, res) => {
  log.info('Python execution cancel requested', { userId: owner(req), executionId: req.params.id });
  const cancelled = cancelExecution(req.params.id, owner(req));
  res.status(cancelled ? 202 : 404).json({
    cancelled,
    message: cancelled
      ? 'Cancellation requested. The remote Python command is being terminated.'
      : 'Execution not found or not owned by this account.'
  });
});

router.get('/artifacts', async (req, res, next) => {
  try {
    const result = await listArtifacts(owner(req), { search: String(req.query.search || ''), limit: req.query.limit });
    return res.json(result);
  } catch (error) { next(error); }
});

router.get('/artifacts/:id', async (req, res, next) => {
  try {
    if (!/^(?:[a-f0-9]{24}|[a-f0-9-]{36})$/i.test(req.params.id)) return res.status(404).json({ error: 'Artifact not found.' });
    const artifact = await getArtifact(req.params.id, owner(req));
    if (!artifact) {
      log.warn('Artifact not found', { userId: owner(req), artifactId: req.params.id });
      return res.status(404).json({ error: 'Artifact not found.' });
    }
    log.info('Artifact downloaded', { userId: owner(req), artifactId: req.params.id, name: artifact.name });
    const previewable = ['text/plain', 'text/csv', 'text/markdown', 'application/json', 'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(artifact.mimeType);
    const inline = req.query.inline === '1' && previewable;
    res.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', artifact.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${artifact.name}"`);
    if (inline) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return res.send(artifact.data);
  } catch (error) { next(error); }
});

router.delete('/artifacts/:id', async (req, res, next) => {
  try {
    if (!/^(?:[a-f0-9]{24}|[a-f0-9-]{36})$/i.test(req.params.id)) return res.status(404).json({ error: 'Artifact not found.' });
    const deleted = await deleteArtifact(req.params.id, owner(req));
    if (!deleted) return res.status(404).json({ error: 'Artifact not found.' });
    return res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
