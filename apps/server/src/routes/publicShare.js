import { Router } from 'express';
import { Share } from '../models/Share.js';
import logger from '../utils/logger.js';

const router = Router();
const log = logger.child({ component: 'routes:publicShare' });
router.get('/:shareId', async (req, res, next) => {
  try {
    const share = await Share.findOne({ shareId: req.params.shareId, revokedAt: null })
      .select('title messages createdAt')
      .lean();
    if (!share) {
      log.warn('Public share not found', { shareId: req.params.shareId });
      return res.status(404).json({ error: 'This shared response is unavailable.' });
    }
    log.info('Public share accessed', { shareId: req.params.shareId });
    res.set('Cache-Control', 'no-store');
    res.json({
      share: { title: share.title, messages: share.messages, createdAt: share.createdAt },
    });
  } catch (error) {
    log.error('Public share access failed', {
      shareId: req.params.shareId,
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
});
export default router;
