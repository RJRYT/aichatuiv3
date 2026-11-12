import { Router } from 'express';
import { Share } from '../models/Share.js';
import logger from '../utils/logger.js';
import { createHash } from 'node:crypto';
import { normalizeStoredBinary } from '../services/interpreter/artifactStore.js';

const router = Router();
const log = logger.child({ component: 'routes:publicShare' });
router.get('/:shareId', async (req, res, next) => {
  try {
    const share = await Share.findOne({ shareId: req.params.shareId, revokedAt: null })
      .select('title messages createdAt shareType artifacts')
      .lean();
    if (!share) {
      log.warn('Public share not found', { shareId: req.params.shareId });
      return res.status(404).json({ error: 'This shared response is unavailable.' });
    }
    log.info('Public share accessed', { shareId: req.params.shareId });
    res.set('Cache-Control', 'no-store');
    res.json({
      share: {
        title: share.title,
        messages: share.messages,
        createdAt: share.createdAt,
        shareType: share.shareType || 'snapshot',
        artifacts: (share.artifacts || []).map(({ id, name, mimeType, size, sha256 }) => ({
          id,
          name,
          mimeType,
          size,
          sha256,
        })),
      },
    });
  } catch (error) {
    log.error('Public share access failed', {
      shareId: req.params.shareId,
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
});
router.get('/:shareId/artifacts/:artifactId', async (req, res, next) => {
  try {
    const share = await Share.findOne({ shareId: req.params.shareId, revokedAt: null })
      .select('artifacts')
      .lean();
    const artifact = (share?.artifacts || []).find(
      (item) => String(item.id) === String(req.params.artifactId)
    );
    if (!artifact?.data) return res.status(404).json({ error: 'Shared file not found.' });
    const data = normalizeStoredBinary(artifact.data);
    if (data.length !== Number(artifact.size))
      return res.status(500).json({ error: 'Shared file failed its size check.' });
    if (artifact.sha256 && createHash('sha256').update(data).digest('hex') !== artifact.sha256)
      return res.status(500).json({ error: 'Shared file failed its integrity check.' });
    res.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(artifact.name || 'shared-file').replace(/["\\\r\n]/g, '_')}"`
    );
    return res.send(data);
  } catch (error) {
    next(error);
  }
});

export default router;
