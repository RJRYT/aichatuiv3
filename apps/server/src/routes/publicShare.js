import { Router } from 'express';
import { Share } from '../models/Share.js';
const router = Router();
router.get('/:shareId', async (req, res, next) => {
  try {
    const share = await Share.findOne({ shareId: req.params.shareId, revokedAt: null }).select('title messages createdAt').lean();
    if (!share) return res.status(404).json({ error: 'This shared response is unavailable.' });
    res.set('Cache-Control', 'no-store');
    res.json({ share: { title: share.title, messages: share.messages, createdAt: share.createdAt } });
  } catch (error) { next(error); }
});
export default router;
