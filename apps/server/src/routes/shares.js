import { Router } from 'express';
import crypto from 'node:crypto';
import { Share } from '../models/Share.js';
import { getChat } from '../services/chatStore.js';
import { ensureBranches, getBranchMessages } from '../services/conversationBranches.js';
import { listArtifacts, getArtifact } from '../services/interpreter/artifactStore.js';
import logger from '../utils/logger.js';

const router = Router();
const owner = (req) => String(req.user?._id || '');
const log = logger.child({ component: 'routes:shares' });
router.get('/', async (req, res, next) => {
  try {
    const shares = await Share.find({ ownerId: owner(req), revokedAt: null })
      .select('shareId title chatId shareType createdAt')
      .sort({ createdAt: -1 })
      .lean();
    log.debug('Shares listed', { userId: owner(req), count: shares.length });
    res.json({ shares });
  } catch (error) {
    next(error);
  }
});
router.post('/', async (req, res, next) => {
  try {
    const {
      chatId,
      branchId,
      messageId,
      includeContext = false,
      shareType = 'snapshot',
    } = req.body || {};
    if (!chatId) return res.status(400).json({ error: 'chatId is required.' });
    if (!['snapshot', 'chat'].includes(shareType))
      return res.status(400).json({ error: 'Unsupported share type.' });
    const chat = await getChat(owner(req), String(chatId));
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    ensureBranches(chat);
    const messages = getBranchMessages(chat, branchId || chat.activeBranchId);
    if (!messages) return res.status(404).json({ error: 'Conversation branch not found.' });

    let snapshot = [];
    let sharedArtifacts = [];
    if (shareType === 'chat') {
      const totalTextBytes = messages.reduce(
        (sum, message) => sum + Buffer.byteLength(String(message?.content || ''), 'utf8'),
        0
      );
      if (messages.length > 300 || totalTextBytes > 2 * 1024 * 1024)
        return res
          .status(413)
          .json({ error: 'This conversation is too large to share in one public snapshot.' });
      snapshot = messages
        .filter((message) => ['user', 'assistant'].includes(message?.role))
        .map((message) => ({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : '[Attachment]',
          createdAt: message.createdAt || null,
        }));

      // Copy a bounded, immutable set of this conversation's generated files into
      // the share record. This keeps the public link independent from later chat edits.
      const library = await listArtifacts(owner(req), { chatId: String(chatId), limit: 100 });
      let totalArtifactBytes = 0;
      for (const metadata of library.files || []) {
        if (sharedArtifacts.length >= 20)
          return res
            .status(413)
            .json({
              error:
                'This conversation has more than 20 generated files. Remove files from this chat before creating a full share.',
            });
        if (totalArtifactBytes + Number(metadata.size || 0) > 8 * 1024 * 1024)
          return res
            .status(413)
            .json({
              error:
                'Generated files exceed the 8 MB public-share limit. Share a smaller set of files or use individual response snapshots.',
            });
        const artifact = await getArtifact(metadata.id, owner(req));
        if (
          !artifact?.data ||
          !Buffer.isBuffer(artifact.data) ||
          artifact.data.length !== Number(metadata.size)
        )
          continue;
        sharedArtifacts.push({
          id: crypto.randomUUID(),
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: artifact.data.length,
          sha256: artifact.sha256,
          data: artifact.data,
        });
        totalArtifactBytes += artifact.data.length;
      }
    } else {
      if (!messageId)
        return res.status(400).json({ error: 'messageId is required for a response snapshot.' });
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0 || messages[index].role !== 'assistant')
        return res.status(404).json({ error: 'Assistant response not found.' });
      const selected = messages[index];
      const safeMessage = {
        role: 'assistant',
        content: typeof selected.content === 'string' ? selected.content : '',
        createdAt: selected.createdAt,
      };
      snapshot =
        includeContext && index > 0
          ? [messages[index - 1], safeMessage].map((m) => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : '[Attachment]',
            }))
          : [safeMessage];
    }

    const share = await Share.create({
      shareId: crypto.randomBytes(18).toString('base64url'),
      ownerId: owner(req),
      chatId: String(chatId),
      title: chat.title || (shareType === 'chat' ? 'Shared conversation' : 'Shared response'),
      shareType,
      messages: snapshot,
      artifacts: sharedArtifacts,
    });
    log.info('Share created', {
      userId: owner(req),
      chatId,
      shareType,
      messageCount: snapshot.length,
      artifactCount: sharedArtifacts.length,
    });
    res.status(201).json({
      shareId: share.shareId,
      shareType,
      artifactCount: sharedArtifacts.length,
      url: `${String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/share/${share.shareId}`,
    });
  } catch (error) {
    next(error);
  }
});
router.delete('/:shareId', async (req, res, next) => {
  try {
    const share = await Share.findOneAndUpdate(
      { shareId: req.params.shareId, ownerId: owner(req), revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { new: true }
    );
    if (!share) {
      log.warn('Share not found for revocation', {
        userId: owner(req),
        shareId: req.params.shareId,
      });
      return res.status(404).json({ error: 'Active share not found.' });
    }
    log.info('Share revoked', { userId: owner(req), shareId: req.params.shareId });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
export default router;
