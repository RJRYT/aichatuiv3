import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeStoredBinary } from './artifactStore.js';

const memoryUploads = new Map();
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_CHAT_BYTES = 50 * 1024 * 1024;
const MAX_CHAT_FILES = 20;
const MAX_OWNER_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_OWNER_UPLOAD_FILES = 100;
const MAX_GLOBAL_UPLOAD_BYTES = 128 * 1024 * 1024;
const MAX_GLOBAL_UPLOAD_FILES = 5000;
function uploadError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const ALLOWED_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'application/pdf',
  'application/zip',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/x-python',
  'text/javascript',
  'application/javascript',
  'text/html',
  'text/css',
  'application/sql',
  'text/x-sql',
  'application/yaml',
  'text/yaml',
  'application/toml',
  'text/x-shellscript',
  'application/x-sh',
]);
async function databaseReady() {
  if (!process.env.MONGODB_URI) return false;
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState !== 1)
    throw uploadError(
      'MongoDB is temporarily unavailable; conversation uploads cannot be stored.',
      503
    );
  return true;
}
async function uploadModel() {
  return (await import('../../models/ConversationUpload.js')).ConversationUpload;
}
function cleanName(name) {
  const base = path.posix.basename(String(name || '').replaceAll('\\', '/'));
  const clean = base
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100);
  if (!clean) throw uploadError('Invalid upload filename.');
  return clean;
}
function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw uploadError('Upload content must be a base64 data URL.');
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw uploadError(`Unsupported file type: ${mimeType}.`, 415);
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > MAX_UPLOAD_BYTES)
    throw uploadError('Each uploaded file must be between 1 byte and 8 MB.', 413);
  if (data.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, ''))
    throw uploadError('Invalid base64 upload content.');
  return { mimeType, data };
}
function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function toMetadata(item) {
  return {
    uploadId: item.uploadId,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
    sha256: item.sha256 || '',
    sandboxPath: item.sandboxPath,
    createdAt: item.createdAt,
  };
}

export function normalizeUploadRecord(file) {
  let data;
  try {
    data = normalizeStoredBinary(file.data);
  } catch (error) {
    throw uploadError(
      `Uploaded file "${file.name}" could not be decoded from storage: ${error.message}`,
      500
    );
  }
  if (data.byteLength !== Number(file.size)) {
    throw uploadError(
      `Uploaded file "${file.name}" is incomplete in storage (expected ${file.size} bytes, received ${data.byteLength}). Please upload it again.`,
      500
    );
  }
  const digest = sha256(data);
  if (file.sha256 && digest !== file.sha256) {
    throw uploadError(
      `Uploaded file "${file.name}" failed its storage checksum. Please upload it again.`,
      500
    );
  }
  return { ...file, data, sha256: digest };
}

export async function storeConversationUploads(ownerId, chatId, files = []) {
  const useDatabase = await databaseReady();
  if (!Array.isArray(files) || !files.length || files.length > 6)
    throw uploadError('Attach between 1 and 6 files per upload request.');
  const owner = String(ownerId),
    chat = String(chatId);
  const prepared = files.map((file) => {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.name !== 'string' ||
      typeof file.dataUrl !== 'string'
    )
      throw uploadError('Each upload needs a filename and base64 file content.');
    const name = cleanName(file.name);
    const { mimeType, data } = parseDataUrl(file.dataUrl);
    return {
      uploadId: randomUUID(),
      name,
      mimeType,
      data,
      size: data.byteLength,
      sha256: sha256(data),
    };
  });
  const requestBytes = prepared.reduce((sum, file) => sum + file.size, 0);
  if (requestBytes > 20 * 1024 * 1024)
    throw uploadError('Combined upload size cannot exceed 20 MB per request.', 413);

  if (useDatabase) {
    const ConversationUpload = await uploadModel();
    const [stats, ownerStats, globalStats] = await Promise.all([
      ConversationUpload.aggregate([
        { $match: { ownerId: owner, chatId: chat } },
        { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } },
      ]),
      ConversationUpload.aggregate([
        { $match: { ownerId: owner } },
        { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } },
      ]),
      ConversationUpload.aggregate([
        { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } },
      ]),
    ]);
    if ((stats[0]?.count || 0) + prepared.length > MAX_CHAT_FILES)
      throw uploadError('This conversation can contain up to 20 uploaded files.', 413);
    if ((stats[0]?.bytes || 0) + requestBytes > MAX_CHAT_BYTES)
      throw uploadError('Uploaded files for this conversation cannot exceed 50 MB.', 413);
    if ((ownerStats[0]?.count || 0) + prepared.length > MAX_OWNER_UPLOAD_FILES)
      throw uploadError(
        'Your account can contain up to 100 uploaded files. Delete conversations you no longer need.',
        413
      );
    if ((ownerStats[0]?.bytes || 0) + requestBytes > MAX_OWNER_UPLOAD_BYTES)
      throw uploadError('Your account upload storage limit is 100 MB.', 413);
    if (
      (globalStats[0]?.count || 0) + prepared.length > MAX_GLOBAL_UPLOAD_FILES ||
      (globalStats[0]?.bytes || 0) + requestBytes > MAX_GLOBAL_UPLOAD_BYTES
    )
      throw uploadError('The shared upload storage is temporarily full. Try again later.', 503);
    const records = prepared.map((file) => ({
      ownerId: owner,
      chatId: chat,
      uploadId: file.uploadId,
      name: file.name,
      mimeType: file.mimeType,
      sandboxPath: `uploads/${file.uploadId}_${file.name}`,
      size: file.size,
      sha256: file.sha256,
      data: file.data,
    }));
    const saved = await ConversationUpload.insertMany(records, { ordered: true });
    return saved.map(toMetadata);
  }

  const existing = [...memoryUploads.values()].filter(
    (file) => file.ownerId === owner && file.chatId === chat
  );
  const ownerUploads = [...memoryUploads.values()].filter((file) => file.ownerId === owner);
  const allUploads = [...memoryUploads.values()];
  if (ownerUploads.length + prepared.length > MAX_OWNER_UPLOAD_FILES)
    throw uploadError(
      'Your account can contain up to 100 uploaded files. Delete conversations you no longer need.',
      413
    );
  if (
    ownerUploads.reduce((sum, file) => sum + file.size, 0) + requestBytes >
    MAX_OWNER_UPLOAD_BYTES
  )
    throw uploadError('Your account upload storage limit is 100 MB.', 413);
  if (
    allUploads.length + prepared.length > MAX_GLOBAL_UPLOAD_FILES ||
    allUploads.reduce((sum, file) => sum + file.size, 0) + requestBytes > MAX_GLOBAL_UPLOAD_BYTES
  )
    throw uploadError('The shared upload storage is temporarily full. Try again later.', 503);
  if (existing.length + prepared.length > MAX_CHAT_FILES)
    throw uploadError('This conversation can contain up to 20 uploaded files.', 413);
  if (existing.reduce((sum, file) => sum + file.size, 0) + requestBytes > MAX_CHAT_BYTES)
    throw uploadError('Uploaded files for this conversation cannot exceed 50 MB.', 413);
  const saved = prepared.map((file) => {
    const item = {
      ...file,
      ownerId: owner,
      chatId: chat,
      sandboxPath: `uploads/${file.uploadId}_${file.name}`,
      createdAt: new Date(),
    };
    memoryUploads.set(file.uploadId, item);
    return item;
  });
  return saved.map(toMetadata);
}

export async function listConversationUploadMetadata(ownerId, chatId) {
  const useDatabase = await databaseReady();
  const owner = String(ownerId),
    chat = String(chatId);
  if (useDatabase) {
    const ConversationUpload = await uploadModel();
    return ConversationUpload.find({ ownerId: owner, chatId: chat })
      .select('uploadId name mimeType sandboxPath size sha256 createdAt')
      .sort({ createdAt: 1 })
      .lean();
  }
  return [...memoryUploads.values()]
    .filter((file) => file.ownerId === owner && file.chatId === chat)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(toMetadata);
}

export async function getConversationUploads(ownerId, chatId, uploadIds = []) {
  const useDatabase = await databaseReady();
  const owner = String(ownerId),
    chat = String(chatId);
  if (!Array.isArray(uploadIds) || !uploadIds.length) return [];
  if (useDatabase) {
    const ConversationUpload = await uploadModel();
    const records = await ConversationUpload.find({
      ownerId: owner,
      chatId: chat,
      uploadId: { $in: uploadIds },
    })
      .select('+data')
      .sort({ createdAt: 1 })
      .lean();
    return records.map(normalizeUploadRecord);
  }
  return uploadIds
    .map((id) => memoryUploads.get(String(id)))
    .filter((file) => file && file.ownerId === owner && file.chatId === chat)
    .map((file) => normalizeUploadRecord({ ...file, data: Buffer.from(file.data) }));
}

export async function listConversationUploads(ownerId, chatId) {
  const metadata = await listConversationUploadMetadata(ownerId, chatId);
  return getConversationUploads(
    ownerId,
    chatId,
    metadata.map((file) => file.uploadId)
  );
}

export async function deleteConversationUploads(ownerId, chatId) {
  const useDatabase = await databaseReady();
  const owner = String(ownerId),
    chat = String(chatId);
  if (useDatabase) {
    const ConversationUpload = await uploadModel();
    const result = await ConversationUpload.deleteMany({ ownerId: owner, chatId: chat });
    return result.deletedCount || 0;
  }
  let deleted = 0;
  for (const [id, file] of memoryUploads)
    if (file.ownerId === owner && file.chatId === chat) {
      memoryUploads.delete(id);
      deleted += 1;
    }
  return deleted;
}
