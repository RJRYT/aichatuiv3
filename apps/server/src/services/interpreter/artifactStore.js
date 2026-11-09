import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import logger from '../../utils/logger.js';

const log = logger.child({ component: 'artifacts' });
const memoryArtifacts = new Map();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OWNER_BYTES = 50 * 1024 * 1024;
const MAX_OWNER_COUNT = 100;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_COUNT = 5000;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,139}$/;
const MIME_TYPES = new Map([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.tsv', 'text/tab-separated-values'],
  ['.json', 'application/json'],
  ['.xml', 'application/xml'],
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.py', 'text/x-python'],
  ['.log', 'text/plain'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.doc', 'application/msword'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.zip', 'application/zip'],
  ['.gz', 'application/gzip'],
  ['.tar', 'application/x-tar'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.bin', 'application/octet-stream'],
]);

async function databaseReady() {
  if (!process.env.MONGODB_URI) return false;
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState !== 1)
    throw Object.assign(
      new Error(
        'MongoDB is temporarily unavailable; persistent File Library storage cannot be accessed.'
      ),
      { status: 503 }
    );
  return true;
}
async function artifactModel() {
  return (await import('../../models/Artifact.js')).Artifact;
}
function safeName(rawName) {
  const supplied = String(rawName || '').trim();
  const base = path.posix.basename(supplied);
  if (!supplied || supplied !== base || supplied.startsWith('.') || !SAFE_NAME.test(supplied)) {
    throw new Error(
      'Artifact name must be a simple filename without folders or special characters.'
    );
  }
  return supplied;
}
function toBuffer(content) {
  if (Buffer.isBuffer(content)) return Buffer.from(content);
  if (content instanceof Uint8Array)
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  throw new Error('Artifact content must be text or bytes.');
}

// MongoDB's BSON decoder returns Binary for Buffer fields in lean() queries.
// Buffer.from(Binary) is not a reliable conversion: BSON Binary stores the
// backing Buffer separately from its logical `position` (used byte length).
export function normalizeStoredBinary(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value && typeof value === 'object') {
    if (value.buffer && (Buffer.isBuffer(value.buffer) || value.buffer instanceof Uint8Array)) {
      const backing = value.buffer;
      const available = backing.byteLength;
      const logicalLength = Number.isInteger(value.position) ? value.position : available;
      if (logicalLength >= 0 && logicalLength <= available) {
        return Buffer.from(backing.buffer, backing.byteOffset, logicalLength);
      }
    }
    if (typeof value.value === 'function') {
      const unwrapped = value.value(true);
      if (Buffer.isBuffer(unwrapped) || unwrapped instanceof Uint8Array) return toBuffer(unwrapped);
    }
    if (Array.isArray(value.data)) return Buffer.from(value.data);
  }
  throw new Error('Stored artifact data is not a supported binary value.');
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function publicMetadata(item) {
  return {
    id: String(item._id || item.id),
    name: item.name,
    size: item.size,
    mimeType: item.mimeType,
    chatId: item.chatId || '',
    executionId: item.executionId || '',
    relativePath: item.relativePath || '',
    sha256: item.sha256 || '',
    createdAt: item.updatedAt || item.createdAt,
    downloadUrl: `/api/interpreter/artifacts/${item._id || item.id}`,
  };
}

export function guessMimeType(name) {
  return (
    MIME_TYPES.get(path.extname(String(name || '')).toLowerCase()) || 'application/octet-stream'
  );
}

export async function storeArtifact({
  ownerId,
  chatId = '',
  executionId = '',
  name,
  relativePath = '',
  content,
  mimeType,
}) {
  const useDatabase = await databaseReady();
  const owner = String(ownerId);
  const safeFileName = safeName(name);
  const data = toBuffer(content);
  if (!data.byteLength) throw new Error('Empty artifacts are not stored.');
  if (data.byteLength > MAX_FILE_BYTES) throw new Error('An artifact cannot exceed 10 MB.');
  const resolvedMime = String(mimeType || guessMimeType(safeFileName)).slice(0, 120);
  const checksum = sha256(data);
  const rel = String(relativePath || '').slice(0, 500);

  if (useDatabase) {
    const Artifact = await artifactModel();
    const existing = rel
      ? await Artifact.findOne({ ownerId: owner, chatId: String(chatId || ''), relativePath: rel })
          .select('_id size')
          .lean()
      : null;
    const stats = await Artifact.aggregate([
      { $match: { ownerId: owner } },
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } },
    ]);
    const count = stats[0]?.count || 0;
    const bytes = stats[0]?.bytes || 0;
    const previousSize = existing?.size || 0;
    if (!existing && count >= MAX_OWNER_COUNT)
      throw new Error('Your File Library is full (100 files). Delete files you no longer need.');
    if (bytes - previousSize + data.byteLength > MAX_OWNER_BYTES)
      throw new Error(
        'Your File Library storage limit is 50 MB. Delete older files before creating more.'
      );
    const global = await Artifact.aggregate([
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } },
    ]);
    if (!existing && (global[0]?.count || 0) >= MAX_TOTAL_COUNT)
      throw new Error('File Library storage is temporarily full.');
    if ((global[0]?.bytes || 0) - previousSize + data.byteLength > MAX_TOTAL_BYTES)
      throw new Error('File Library storage is temporarily full.');
    const item = existing
      ? await Artifact.findOneAndUpdate(
          { _id: existing._id, ownerId: owner },
          {
            $set: {
              name: safeFileName,
              mimeType: resolvedMime,
              size: data.byteLength,
              data,
              sha256: checksum,
              executionId: String(executionId || ''),
              updatedAt: new Date(),
            },
          },
          { new: true }
        ).select('+data')
      : await Artifact.create({
          ownerId: owner,
          chatId: String(chatId || ''),
          executionId: String(executionId || ''),
          name: safeFileName,
          relativePath: rel,
          mimeType: resolvedMime,
          size: data.byteLength,
          sha256: checksum,
          data,
        });
    log.info('Artifact saved to persistent library', {
      owner,
      name: safeFileName,
      size: data.byteLength,
      artifactId: String(item._id),
    });
    return publicMetadata(item);
  }

  const existing = rel
    ? [...memoryArtifacts.values()].find(
        (item) =>
          item.ownerId === owner &&
          item.chatId === String(chatId || '') &&
          item.relativePath === rel
      )
    : null;
  const owned = [...memoryArtifacts.values()].filter((item) => item.ownerId === owner);
  const totalBytes = owned.reduce((sum, item) => sum + item.size, 0);
  const allItems = [...memoryArtifacts.values()];
  if (!existing && allItems.length >= MAX_TOTAL_COUNT)
    throw new Error('File Library storage is temporarily full.');
  if (
    allItems.reduce((sum, item) => sum + item.size, 0) - (existing?.size || 0) + data.byteLength >
    MAX_TOTAL_BYTES
  )
    throw new Error('File Library storage is temporarily full.');
  if (!existing && owned.length >= MAX_OWNER_COUNT)
    throw new Error('Your File Library is full (100 files).');
  if (totalBytes - (existing?.size || 0) + data.byteLength > MAX_OWNER_BYTES)
    throw new Error('Your File Library storage limit is 50 MB.');
  const id = existing?.id || randomUUID();
  const item = {
    id,
    ownerId: owner,
    chatId: String(chatId || ''),
    executionId: String(executionId || ''),
    name: safeFileName,
    relativePath: rel,
    mimeType: resolvedMime,
    size: data.byteLength,
    sha256: checksum,
    data: Buffer.from(data),
    createdAt: existing?.createdAt || new Date(),
    updatedAt: new Date(),
  };
  memoryArtifacts.set(id, item);
  return publicMetadata(item);
}

export async function listArtifacts(ownerId, { search = '', limit = 100 } = {}) {
  const useDatabase = await databaseReady();
  const owner = String(ownerId);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  if (useDatabase) {
    const Artifact = await artifactModel();
    const filter = { ownerId: owner };
    const term = String(search || '')
      .trim()
      .slice(0, 100);
    if (term) filter.name = { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const items = await Artifact.find(filter)
      .select('-data')
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(safeLimit)
      .lean();
    const total = await Artifact.countDocuments({ ownerId: owner });
    const totalBytes = await Artifact.aggregate([
      { $match: { ownerId: owner } },
      { $group: { _id: null, bytes: { $sum: '$size' } } },
    ]);
    return {
      files: items.map(publicMetadata),
      total,
      totalBytes: totalBytes[0]?.bytes || 0,
      quotaBytes: MAX_OWNER_BYTES,
      quotaFiles: MAX_OWNER_COUNT,
    };
  }
  const all = [...memoryArtifacts.values()]
    .filter((item) => item.ownerId === owner)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const term = String(search || '').toLowerCase();
  const filtered = term ? all.filter((item) => item.name.toLowerCase().includes(term)) : all;
  return {
    files: filtered.slice(0, safeLimit).map(publicMetadata),
    total: all.length,
    totalBytes: all.reduce((sum, item) => sum + item.size, 0),
    quotaBytes: MAX_OWNER_BYTES,
    quotaFiles: MAX_OWNER_COUNT,
  };
}

export async function getArtifact(id, ownerId) {
  const useDatabase = await databaseReady();
  if (useDatabase) {
    const Artifact = await artifactModel();
    const item = await Artifact.findOne({ _id: id, ownerId: String(ownerId) })
      .select('+data')
      .lean();
    if (!item) return null;
    const data = normalizeStoredBinary(item.data);
    if (data.byteLength !== Number(item.size)) {
      log.error('Artifact integrity check failed: stored size mismatch', {
        artifactId: String(item._id),
        expectedBytes: item.size,
        actualBytes: data.byteLength,
      });
      throw Object.assign(
        new Error(
          'This file is incomplete in storage and cannot be downloaded safely. Please regenerate it.'
        ),
        { status: 500, code: 'ARTIFACT_SIZE_MISMATCH' }
      );
    }
    if (item.sha256 && sha256(data) !== item.sha256) {
      log.error('Artifact integrity check failed: checksum mismatch', {
        artifactId: String(item._id),
      });
      throw Object.assign(
        new Error(
          'This file failed its integrity check and cannot be downloaded safely. Please regenerate it.'
        ),
        { status: 500, code: 'ARTIFACT_CHECKSUM_MISMATCH' }
      );
    }
    return { ...publicMetadata(item), data };
  }
  const item = memoryArtifacts.get(String(id));
  return item && item.ownerId === String(ownerId)
    ? { ...publicMetadata(item), data: Buffer.from(item.data) }
    : null;
}

export async function deleteArtifact(id, ownerId) {
  const useDatabase = await databaseReady();
  if (useDatabase) {
    const Artifact = await artifactModel();
    const result = await Artifact.deleteOne({ _id: id, ownerId: String(ownerId) });
    return result.deletedCount === 1;
  }
  const item = memoryArtifacts.get(String(id));
  if (!item || item.ownerId !== String(ownerId)) return false;
  memoryArtifacts.delete(String(id));
  return true;
}

export async function deleteArtifacts(ids = [], ownerId) {
  const useDatabase = await databaseReady();
  const owner = String(ownerId);
  if (useDatabase) {
    const Artifact = await artifactModel();
    const result = await Artifact.deleteMany({ _id: { $in: ids }, ownerId: owner });
    return result.deletedCount || 0;
  }
  let deleted = 0;
  for (const id of ids) {
    const item = memoryArtifacts.get(String(id));
    if (item?.ownerId === owner) {
      memoryArtifacts.delete(String(id));
      deleted += 1;
    }
  }
  return deleted;
}
