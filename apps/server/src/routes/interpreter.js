import { Router } from 'express';
import { executePython, cancelExecution } from '../services/interpreter/interpreter.js';
import { getArtifact } from '../services/interpreter/artifactStore.js';
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
      ? 'Cancellation requested. Monty will stop at its next cooperative cancellation check or execution limit.'
      : 'Execution not found or not owned by this account.'
  });
});

router.get('/artifacts/:id', (req, res) => {
  const artifact = getArtifact(req.params.id, owner(req));
  if (!artifact) {
    log.warn('Artifact not found', { userId: owner(req), artifactId: req.params.id });
    return res.status(404).json({ error: 'Artifact not found.' });
  }
  log.info('Artifact downloaded', { userId: owner(req), artifactId: req.params.id, name: artifact.name });
  res.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.download(artifact.path, artifact.name);
});

export default router;
