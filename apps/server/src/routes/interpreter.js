import { Router } from 'express';
import { executePython, cancelExecution } from '../services/interpreter/interpreter.js';
import { getArtifact } from '../services/interpreter/artifactStore.js';
const router = Router();
const owner = req => String(req.user?._id || '');
router.post('/execute', async (req, res, next) => {
  try {
    if (!owner(req) || owner(req).startsWith('guest:')) return res.status(401).json({ error: 'A signed-in account is required for Python execution.' });
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    const result = await executePython(req.body, owner(req), { signal: controller.signal });
    res.status(result.status === 'completed' ? 200 : result.status === 'timeout' ? 408 : 422).json(result);
  } catch (error) { next(error); }
});
router.post('/cancel/:id', (req, res) => {
  const cancelled = cancelExecution(req.params.id, owner(req));
  res.status(cancelled ? 202 : 404).json({ cancelled, message: cancelled ? 'Cancellation requested.' : 'Execution not found or not owned by this account.' });
});
router.get('/artifacts/:id', (req, res) => {
  const artifact = getArtifact(req.params.id, owner(req));
  if (!artifact) return res.status(404).json({ error: 'Artifact not found.' });
  res.download(artifact.path, artifact.name);
});
export default router;
