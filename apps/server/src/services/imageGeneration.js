import { randomUUID } from 'node:crypto';
import { storeArtifact } from './interpreter/artifactStore.js';
import logger from '../utils/logger.js';

const log = logger.child({ component: 'image-generation' });
const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_PROMPT_LENGTH = 2048;
const MAX_IMAGES_PER_REQUEST = 2;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const dailyUsage = new Map();
const MAX_IMAGES_PER_USER_PER_DAY = Math.max(
  1,
  Math.min(30, Number(process.env.IMAGE_GENERATION_DAILY_LIMIT) || 8)
);

function reserveUsage(userId, count) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${day}`;
  const current = dailyUsage.get(key) || 0;
  if (current + count > MAX_IMAGES_PER_USER_PER_DAY) {
    throw Object.assign(
      new Error(
        `Daily image-generation limit reached (${MAX_IMAGES_PER_USER_PER_DAY} images). Try again tomorrow.`
      ),
      { status: 429, code: 'IMAGE_DAILY_LIMIT' }
    );
  }
  dailyUsage.set(key, current + count);
  for (const oldKey of dailyUsage.keys())
    if (!oldKey.endsWith(`:${day}`)) dailyUsage.delete(oldKey);
  return (used) =>
    dailyUsage.set(
      key,
      Math.max(0, (dailyUsage.get(key) || count) - Math.max(0, count - Number(used || 0)))
    );
}

function imageBufferFromResult(result) {
  if (typeof result?.image !== 'string' || !result.image)
    throw new Error('The image provider returned no image data.');
  const encoded = result.image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw new Error('The image provider returned invalid base64 data.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error('Generated image is empty or exceeds the 10 MB artifact limit.');
  let mimeType = 'image/jpeg',
    extension = 'jpg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    mimeType = 'image/png';
    extension = 'png';
  } else if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    mimeType = 'image/webp';
    extension = 'webp';
  } else if (!(bytes[0] === 0xff && bytes[1] === 0xd8))
    throw new Error('The image provider returned an unsupported or unrecognized image format.');
  return { bytes, mimeType, extension };
}

export async function generateImageArtifact(args, user, options = {}) {
  const userId = String(user?._id || '');
  if (!userId || userId.startsWith('guest:'))
    throw Object.assign(new Error('Sign in is required to generate and save images.'), {
      status: 401,
    });
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken)
    throw Object.assign(
      new Error(
        'Image generation is not configured. Add the Cloudflare account ID and API token to the backend environment.'
      ),
      { status: 503, code: 'IMAGE_PROVIDER_NOT_CONFIGURED' }
    );
  const prompt = String(args.prompt || '').trim();
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH)
    throw new Error(`Image prompt must contain between 1 and ${MAX_PROMPT_LENGTH} characters.`);
  const steps = Math.max(1, Math.min(8, Number(args.steps) || 4));
  const count = Math.max(1, Math.min(MAX_IMAGES_PER_REQUEST, Number(args.count) || 1));
  const releaseUsage = reserveUsage(userId, count);
  const model = process.env.CLOUDFLARE_IMAGE_MODEL || MODEL;
  if (!/^@cf\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(model))
    throw new Error('Configured Cloudflare image model identifier is invalid.');
  const timeout = Math.max(
    15000,
    Math.min(180000, Number(process.env.CLOUDFLARE_IMAGE_TIMEOUT_MS) || 120000)
  );
  const artifacts = [];
  try {
    for (let index = 0; index < count; index += 1) {
      if (options.signal?.aborted)
        throw Object.assign(new Error('Image generation was cancelled.'), { name: 'AbortError' });
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, steps }),
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
            : AbortSignal.timeout(timeout),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        const message =
          payload?.errors
            ?.map((item) => item.message)
            .filter(Boolean)
            .join('; ') ||
          payload?.messages
            ?.map((item) => item.message)
            .filter(Boolean)
            .join('; ') ||
          `Image provider returned HTTP ${response.status}.`;
        throw Object.assign(new Error(message), {
          status: response.status >= 400 && response.status < 500 ? response.status : 502,
        });
      }
      const { bytes, mimeType, extension } = imageBufferFromResult(payload?.result);
      const name = `nemi-image-${new Date().toISOString().replace(/[:.]/g, '-')}-${index + 1}.${extension}`;
      const stored = await storeArtifact({
        ownerId: userId,
        chatId: options.chatId || '',
        executionId: `image-${randomUUID()}`,
        name,
        relativePath: `generated-images/${name}`,
        content: bytes,
        mimeType,
      });
      artifacts.push({
        id: stored.id,
        name: stored.name,
        size: stored.size,
        mimeType: stored.mimeType,
        sha256: stored.sha256,
        chatId: stored.chatId,
        createdAt: stored.createdAt,
      });
      log.info('Generated image saved', {
        userId,
        chatId: options.chatId,
        artifactId: stored.id,
        size: bytes.byteLength,
        model,
      });
      options.onProgress?.({
        completed: index + 1,
        total: count,
        artifact: artifacts[artifacts.length - 1],
      });
    }
    return { status: 'completed', model, prompt, steps, artifacts };
  } catch (error) {
    releaseUsage(artifacts.length);
    log.warn('Image generation failed', {
      userId,
      chatId: options.chatId,
      savedCount: artifacts.length,
      message: error instanceof Error ? error.message : String(error),
    });
    if (artifacts.length)
      return {
        status: 'partial',
        model,
        prompt,
        steps,
        artifacts,
        error: error instanceof Error ? error.message : 'Image generation partially failed.',
      };
    throw error;
  }
}

export function getImageGenerationStatus() {
  return {
    configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
    model: process.env.CLOUDFLARE_IMAGE_MODEL || MODEL,
    maxImagesPerRequest: MAX_IMAGES_PER_REQUEST,
    dailyUserLimit: MAX_IMAGES_PER_USER_PER_DAY,
  };
}
