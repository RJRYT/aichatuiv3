import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import logger from '../../utils/logger.js';

const log = logger.child({ component: 'artifacts' });
const artifacts = new Map();
const pendingReservations = new Map();
const TTL_MS = 60 * 60 * 1000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_OWNER_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_COUNT = 256;
const MAX_OWNER_COUNT = 32;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/;
const MIME_TYPES = new Map([
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/json', '.json'],
  ['application/pdf', '.pdf'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/svg+xml', '.svg'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/zip', '.zip'],
  ['application/octet-stream', '.bin']
]);

async function pruneExpired() {
  const expired = [];
  for (const [id, item] of artifacts) {
    if (item.expiresAt <= Date.now()) {
      artifacts.delete(id);
      expired.push(item.dir);
    }
  }
  for (const dir of new Set(expired)) {
    if (![...artifacts.values()].some(item => item.dir === dir)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function normalizeArtifactName(rawName, mimeType) {
  const supplied = String(rawName || '').trim();
  if (!supplied || supplied !== path.posix.basename(supplied) || supplied !== path.win32.basename(supplied) ||
      supplied.includes('..') || !SAFE_NAME.test(supplied)) {
    throw new Error('Artifact name must be a simple filename without folders or special characters.');
  }
  const requiredExtension = MIME_TYPES.get(mimeType);
  const currentExtension = path.extname(supplied).toLowerCase();
  if (currentExtension && currentExtension !== requiredExtension) {
    throw new Error(`The filename extension must be ${requiredExtension} for ${mimeType}.`);
  }
  return currentExtension ? supplied : `${supplied}${requiredExtension}`;
}

export async function storeArtifact({ ownerId, name, content, mimeType = 'text/plain' }) {
  const owner = String(ownerId);
  log.debug('Artifact store requested', { owner, name, mimeType });
  await pruneExpired();
  if (!MIME_TYPES.has(mimeType)) throw new Error('Unsupported artifact MIME type.');
  const safeName = normalizeArtifactName(name, mimeType);
  let data;
  if (Buffer.isBuffer(content)) data = content;
  else if (content instanceof Uint8Array) data = Buffer.from(content);
  else if (typeof content === 'string') data = Buffer.from(content, 'utf8');
  else throw new Error('Artifact content must be text or bytes.');
  if (!data.byteLength) throw new Error('Empty artifacts are not allowed.');
  if (data.byteLength > 10 * 1024 * 1024) throw new Error('An artifact cannot exceed 10 MB.');

  // Reserve capacity before the first filesystem await so concurrent tool calls
  // cannot race past the process-wide or per-owner storage budgets.
  let totalBytes = 0;
  let ownerBytes = 0;
  let totalCount = artifacts.size;
  let ownerCount = 0;
  for (const item of artifacts.values()) {
    totalBytes += item.size;
    if (item.ownerId === owner) {
      ownerBytes += item.size;
      ownerCount += 1;
    }
  }
  for (const item of pendingReservations.values()) {
    totalBytes += item.size;
    totalCount += 1;
    if (item.ownerId === owner) {
      ownerBytes += item.size;
      ownerCount += 1;
    }
  }
  if (totalCount + 1 > MAX_TOTAL_COUNT) throw new Error('The server artifact storage is currently full. Try again after older artifacts expire.');
  if (ownerCount + 1 > MAX_OWNER_COUNT) throw new Error('You have reached the stored artifact count limit. Older artifacts expire after one hour.');
  if (totalBytes + data.byteLength > MAX_TOTAL_BYTES) throw new Error('The server artifact storage limit has been reached. Try again later.');
  if (ownerBytes + data.byteLength > MAX_OWNER_BYTES) throw new Error('Your stored artifact quota is 20 MB. Download or wait for older artifacts to expire.');

  const reservationId = randomUUID();
  pendingReservations.set(reservationId, { ownerId: owner, size: data.byteLength });
  const id = randomUUID();
  let dir;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nemotron-monty-artifact-'));
    const artifactPath = path.join(dir, safeName);
    await fs.writeFile(artifactPath, data, { flag: 'wx', mode: 0o600 });
    artifacts.set(id, {
      ownerId: owner, name: safeName, path: artifactPath, size: data.byteLength,
      mimeType, dir, expiresAt: Date.now() + TTL_MS
    });
  } catch (error) {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    pendingReservations.delete(reservationId);
  }
  log.info('Artifact stored', { owner, name: safeName, size: data.byteLength, mimeType, artifactId: id });
  return {
    id, name: safeName, size: data.byteLength, mimeType,
    downloadUrl: `/api/interpreter/artifacts/${id}`
  };
}

export async function deleteArtifacts(ids = [], ownerId) {
  const dirs = new Set();
  for (const id of ids) {
    const item = artifacts.get(id);
    if (item && item.ownerId === String(ownerId)) {
      artifacts.delete(id);
      dirs.add(item.dir);
    }
  }
  for (const dir of dirs) {
    if (![...artifacts.values()].some(item => item.dir === dir)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function getArtifact(id, ownerId) {
  const item = artifacts.get(id);
  if (!item || item.expiresAt <= Date.now() || item.ownerId !== String(ownerId)) return null;
  return item;
}

export async function pruneArtifacts() {
  await pruneExpired();
}
