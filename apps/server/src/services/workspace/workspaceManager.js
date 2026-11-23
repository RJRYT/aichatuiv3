import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { WorkspaceFile } from '../../models/WorkspaceFile.js';
import { getChat } from '../chatStore.js';
import { guessMimeType, storeArtifact } from '../interpreter/artifactStore.js';
import { inspectZipBuffer } from '../archiveValidation.js';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';

const memoryFiles = new Map();
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_WORKSPACE_BYTES = 20 * 1024 * 1024;
const MAX_WORKSPACE_FILES = 500;
// Legacy workspace directories were stored as 1-byte placeholder file records.
const LEGACY_DIRECTORY_MARKER_SHA256 = 'd10b36aa74a59bcf4a88185837f658afaf3646eff2bb16c3928d0e9335e945d2';
const isLegacyDirectoryMarker = (file) => Number(file?.size) === 1 && file?.sha256 === LEGACY_DIRECTORY_MARKER_SHA256;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function databaseReady() {
  if (!process.env.MONGODB_URI) return false;
  if (mongoose.connection.readyState !== 1) throw Object.assign(new Error('MongoDB is temporarily unavailable; the persistent workspace cannot be accessed.'), { status: 503 });
  return true;
}

export function normalizeWorkspacePath(raw) {
  const supplied = String(raw || '').replaceAll('\\', '/').trim();
  if (!supplied || supplied.length > 500 || supplied.startsWith('/') || /^[a-zA-Z]:/.test(supplied)) {
    throw new Error('Provide a valid relative workspace path.');
  }
  const parts = supplied.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Workspace paths cannot contain empty or traversal path segments.');
  }
  if (parts.some((part) => /[\u0000-\u001f<>:"|?*]/.test(part))) {
    throw new Error('Workspace path contains unsupported characters.');
  }
  return parts.join('/');
}

function key(ownerId, chatId, path) {
  return `${String(ownerId)}:${String(chatId)}:${path}`;
}

async function assertWorkspace(ownerId, chatId) {
  if (!ownerId || String(ownerId).startsWith('guest:')) {
    throw new Error('Sign in is required to use persistent project workspaces.');
  }
  if (!chatId) throw new Error('A conversation is required for workspace operations.');
  const chat = await getChat(String(ownerId), String(chatId));
  if (!chat) throw new Error('This conversation does not exist or is not accessible.');
}

async function findFile(ownerId, chatId, path) {
  const record = databaseReady()
    ? await WorkspaceFile.findOne({ ownerId: String(ownerId), chatId: String(chatId), path }).lean()
    : memoryFiles.get(key(ownerId, chatId, path)) || null;
  return record && !isLegacyDirectoryMarker(record) ? record : null;
}

async function listRecords(ownerId, chatId) {
  if (databaseReady()) {
    return (await WorkspaceFile.find({ ownerId: String(ownerId), chatId: String(chatId) })
      .select('path content size revision sha256 createdAt updatedAt')
      .sort({ path: 1 }).lean()).filter((file) => !isLegacyDirectoryMarker(file));
  }
  return [...memoryFiles.values()].filter((file) => file.ownerId === String(ownerId) && file.chatId === String(chatId) && !isLegacyDirectoryMarker(file));
}

export async function listWorkspaceFiles(ownerId, chatId, prefix = '') {
  await assertWorkspace(ownerId, chatId);
  const normalizedPrefix = prefix ? normalizeWorkspacePath(prefix).replace(/\/$/, '') : '';
  const files = await listRecords(ownerId, chatId);
  const visibleFiles = files.filter((file) => !normalizedPrefix || file.path.startsWith(`${normalizedPrefix}/`) || file.path === normalizedPrefix);
  const directories = new Set();
  for (const file of visibleFiles) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index++) {
      const directory = parts.slice(0, index).join('/');
      if (!normalizedPrefix || directory === normalizedPrefix || directory.startsWith(`${normalizedPrefix}/`)) directories.add(directory);
    }
  }
  return {
    files: visibleFiles.map(({ path, size, revision, sha256, updatedAt }) => ({ path, type: 'file', size, revision, sha256, updatedAt })),
    directories: [...directories].sort().map((path) => ({ path, type: 'directory' })),
    fileCount: files.length,
    directoryCount: directories.size,
    totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
  };
}

export async function readWorkspaceFile(ownerId, chatId, rawPath, options = {}) {
  await assertWorkspace(ownerId, chatId);
  const path = normalizeWorkspacePath(rawPath);
  const file = await findFile(ownerId, chatId, path);
  if (!file) {
    const records = await listRecords(ownerId, chatId);
    if (records.some((item) => item.path.startsWith(`${path}/`))) throw new Error(`Workspace path is a directory, not a file: ${path}`);
    throw new Error(`Workspace file not found: ${path}`);
  }
  const allLines = String(file.content || '').split(/\r?\n/);
  const full = Boolean(options.full);
  const startLine = full ? 1 : Math.max(1, Number(options.startLine) || 1);
  const maxLines = full ? allLines.length : Math.max(1, Math.min(500, Number(options.maxLines) || 200));
  const selected = allLines.slice(startLine - 1, startLine - 1 + maxLines);
  const nextLine = startLine - 1 + selected.length + 1;
  return {
    path, content: selected.join('\n'), size: file.size, revision: file.revision, sha256: file.sha256,
    totalLines: allLines.length, startLine, nextLine: nextLine <= allLines.length ? nextLine : null,
    truncated: nextLine <= allLines.length, updatedAt: file.updatedAt,
  };
}

export async function createWorkspaceFile(ownerId, chatId, rawPath, content, { overwrite = false } = {}) {
  await assertWorkspace(ownerId, chatId);
  const path = normalizeWorkspacePath(rawPath);
  const text = String(content ?? '');
  const size = Buffer.byteLength(text, 'utf8');
  if (size > MAX_FILE_BYTES) throw new Error('A workspace file cannot exceed 1 MB.');
  const existing = await findFile(ownerId, chatId, path);
  const currentRecords = await listRecords(ownerId, chatId);
  if (currentRecords.some((item) => item.path.startsWith(`${path}/`))) throw new Error(`Cannot create file at ${path}: a directory already exists at this path.`);
  // Remove an orphaned legacy marker at this exact path before creating a real file.
  if (!existing) {
    if (databaseReady()) {
      const legacy = await WorkspaceFile.findOne({ ownerId: String(ownerId), chatId: String(chatId), path }).lean();
      if (legacy && isLegacyDirectoryMarker(legacy)) await WorkspaceFile.deleteOne({ ownerId: String(ownerId), chatId: String(chatId), path });
    } else {
      const legacy = memoryFiles.get(key(ownerId, chatId, path));
      if (legacy && isLegacyDirectoryMarker(legacy)) memoryFiles.delete(key(ownerId, chatId, path));
    }
  }
  const parentFile = path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/')).find((parent) => currentRecords.some((item) => item.path === parent));
  if (parentFile) throw new Error(`Cannot create ${path}: parent path ${parentFile} is a file, not a directory.`);
  if (existing && !overwrite) throw new Error(`Workspace file already exists: ${path}. Use workspace_edit or explicitly enable overwrite.`);
  const files = currentRecords;
  const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0) - Number(existing?.size || 0) + size;
  if (!existing && files.length >= MAX_WORKSPACE_FILES) throw new Error('Workspace file limit reached (500 files).');
  if (total > MAX_WORKSPACE_BYTES) throw new Error('Workspace storage limit reached (20 MB).');
  const now = new Date();
  const record = {
    ownerId: String(ownerId), chatId: String(chatId), path, content: text, size,
    revision: Number(existing?.revision || 0) + 1, sha256: sha256(text),
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
  if (databaseReady()) {
    const saved = await WorkspaceFile.findOneAndUpdate(
      { ownerId: record.ownerId, chatId: record.chatId, path, ...(existing ? { revision: existing.revision } : {}) },
      { $set: record },
      { upsert: !existing, new: true, runValidators: true }
    );
    if (!saved) throw new Error('Workspace file changed during this operation. Read the latest revision and retry.');
  } else memoryFiles.set(key(ownerId, chatId, path), record);
  return { path, size, revision: record.revision, sha256: record.sha256, created: !existing };
}

export async function editWorkspaceFile(ownerId, chatId, rawPath, args = {}) {
  const current = await readWorkspaceFile(ownerId, chatId, rawPath, { full: true });
  if (args.expectedRevision != null && Number(args.expectedRevision) !== current.revision) {
    throw new Error(`Stale workspace edit for ${current.path}. Expected revision ${args.expectedRevision}, current revision is ${current.revision}. Read the file again before editing.`);
  }
  let next;
  if (args.mode === 'append') next = current.content + String(args.newText ?? '');
  else if (args.mode === 'replace') {
    const oldText = String(args.oldText ?? '');
    if (!oldText) throw new Error('Exact replacement requires non-empty oldText.');
    const first = current.content.indexOf(oldText);
    if (first < 0) throw new Error('The exact oldText was not found. Read the current file and prepare a fresh edit.');
    if (current.content.indexOf(oldText, first + oldText.length) >= 0 && !args.replaceAll) {
      throw new Error('oldText matches more than once. Provide a more specific anchor or set replaceAll=true.');
    }
    next = args.replaceAll ? current.content.split(oldText).join(String(args.newText ?? '')) : current.content.slice(0, first) + String(args.newText ?? '') + current.content.slice(first + oldText.length);
  } else if (args.mode === 'overwrite') next = String(args.content ?? '');
  else throw new Error('Edit mode must be append, replace, or overwrite.');
  return createWorkspaceFile(ownerId, chatId, current.path, next, { overwrite: true });
}

export async function deleteWorkspaceFile(ownerId, chatId, rawPath) {
  await assertWorkspace(ownerId, chatId);
  const path = normalizeWorkspacePath(rawPath);
  const existing = await findFile(ownerId, chatId, path);
  const descendants = (await listRecords(ownerId, chatId)).filter((item) => item.path.startsWith(`${path}/`));
  if (!existing && !descendants.length) return { deleted: false, path };
  if (databaseReady()) await WorkspaceFile.deleteMany({ ownerId: String(ownerId), chatId: String(chatId), path: { $in: [path, ...descendants.map((item) => item.path)] } });
  else { memoryFiles.delete(key(ownerId, chatId, path)); for (const item of descendants) memoryFiles.delete(key(ownerId, chatId, item.path)); }
  return { deleted: true, path, deletedCount: descendants.length + (existing ? 1 : 0), recursive: descendants.length > 0 };
}

export async function searchWorkspaceFiles(ownerId, chatId, query, prefix = '') {
  const listing = await listWorkspaceFiles(ownerId, chatId, prefix);
  const needle = String(query || '').toLowerCase();
  if (!needle) throw new Error('A non-empty search query is required.');
  const results = [];
  for (const file of listing.files) {
    const item = await readWorkspaceFile(ownerId, chatId, file.path, { full: true });
    const lines = item.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(needle) && results.length < 100) {
        results.push({ path: file.path, line: index + 1, text: line.slice(0, 500) });
      }
    });
    if (results.length >= 100) break;
  }
  return { query: String(query), results, truncated: results.length >= 100 };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const compressed = deflateRawSync(content);
    const crc = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

export async function exportWorkspaceFile(ownerId, chatId, rawPath, requestedName = '') {
  await assertWorkspace(ownerId, chatId);
  const file = await readWorkspaceFile(ownerId, chatId, rawPath, { full: true });
  const baseName = String(requestedName || file.path.split('/').at(-1) || 'download.txt');
  if (baseName.includes('/') || baseName.includes('\\\\')) throw new Error('Export name must be a filename, not a path.');
  const artifact = await storeArtifact({
    ownerId,
    chatId,
    name: baseName,
    relativePath: file.path,
    content: file.content,
    mimeType: guessMimeType(baseName),
  });
  return {
    exported: true,
    path: file.path,
    size: Buffer.byteLength(file.content, 'utf8'),
    sha256: file.sha256,
    artifact,
    artifacts: [artifact],
  };
}


async function verifyArchiveExtraction(archive, expectedFiles) {
  const verification = inspectZipBuffer(archive);
  if (!verification.valid) throw new Error(`Workspace archive verification failed: ${verification.reason}`);
  const expected = new Map(expectedFiles.map((file) => [file.path, { sha256: sha256(Buffer.from(file.content, 'utf8')), size: Buffer.byteLength(file.content, 'utf8') }]));
  const actual = new Map((verification.entries || []).map((entry) => [entry.name, { sha256: sha256(entry.content), size: entry.uncompressedSize }]));
  if (expected.size !== actual.size || [...expected].some(([path, value]) => actual.get(path)?.sha256 !== value.sha256 || actual.get(path)?.size !== value.size)) {
    throw new Error('Workspace archive verification failed: extracted ZIP entries do not match the workspace manifest.');
  }
  const tempRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'nemotron-zip-verify-'));
  try {
    for (const entry of verification.entries) {
      const segments = entry.name.replaceAll('\\', '/').split('/');
      if (!entry.name || entry.name.startsWith('/') || segments.some((part) => !part || part === '.' || part === '..')) throw new Error(`Workspace archive contains an unsafe path: ${entry.name}`);
      const target = nodePath.resolve(tempRoot, ...segments);
      if (!target.startsWith(`${tempRoot}${nodePath.sep}`)) throw new Error(`Workspace archive path escaped verification directory: ${entry.name}`);
      await fs.mkdir(nodePath.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.content, { flag: 'wx' });
    }
    const extracted = new Map();
    for (const [relativePath, expectedValue] of expected) {
      const target = nodePath.resolve(tempRoot, ...relativePath.split('/'));
      const bytes = await fs.readFile(target);
      const digest = sha256(bytes);
      if (bytes.byteLength !== expectedValue.size || digest !== expectedValue.sha256) throw new Error(`Extracted archive file failed verification: ${relativePath}`);
      extracted.set(relativePath, digest);
    }
    if (extracted.size !== expected.size) throw new Error('Extracted archive contains an unexpected file count.');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  return { archiveValid: true, contentVerified: true, fileCount: expected.size };
}

export async function archiveWorkspace(ownerId, chatId, name = 'project.zip') {
  await assertWorkspace(ownerId, chatId);
  const records = (await listRecords(ownerId, chatId)).filter((item) => !isSensitiveWorkspacePath(item.path));
  if (!records.length) throw new Error('The workspace contains no non-secret files to archive.');
  const filePaths = new Set(records.map((item) => item.path));
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/');
      if (filePaths.has(parent)) throw new Error(`Cannot archive workspace: path collision; ${parent} is both a file and a parent directory.`);
    }
  }
  const files = [];
  for (const item of records) {
    const full = await findFile(ownerId, chatId, item.path);
    if (!full || isLegacyDirectoryMarker(full)) continue;
    files.push({ path: item.path, content: full.content, sha256: full.sha256, size: full.size });
  }
  if (!files.length) throw new Error('The workspace contains no real files to archive after removing legacy directory markers.');
  const archive = createZip(files);
  const verification = await verifyArchiveExtraction(archive, files);
  if (!verification.archiveValid || !verification.contentVerified || verification.fileCount !== files.length) throw new Error('Workspace archive verification failed: extracted manifest mismatch.');
  const safeName = String(name || 'project.zip').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const filename = safeName.toLowerCase().endsWith('.zip') ? safeName : `${safeName}.zip`;
  const artifact = await storeArtifact({ ownerId, chatId, name: filename, relativePath: filename, content: archive, mimeType: 'application/zip' });
  return { archived: true, verified: true, archiveValid: true, contentVerified: true, projectComplete: null, projectCompleteness: 'not_assessed_no_project_manifest', deliveryReady: Boolean(artifact?.id || artifact?.downloadUrl), artifact, artifacts: [artifact], fileCount: files.length, totalBytes: archive.length, workspaceFiles: files.map((file) => file.path), manifest: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })) };
}


function isSensitiveWorkspacePath(rawPath) {
  if (String(rawPath || '').split('/').includes('.git')) return true;
  const base = String(rawPath || '').split('/').at(-1).toLowerCase();
  if (base === '.env' || (base.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(base))) return true;
  return ['id_rsa', 'id_ed25519', 'id_ecdsa', 'credentials.json', 'service-account.json', 'authorized_keys', '.npmrc', '.pypirc', '.netrc', '.git-credentials', '.ds_store'].includes(base) || /\.(pem|key|p12|pfx)$/i.test(base);
}

export async function getWorkspaceSnapshot(ownerId, chatId) {
  const listing = await listWorkspaceFiles(ownerId, chatId);
  const files = [];
  for (const item of listing.files) {
    if (isSensitiveWorkspacePath(item.path)) continue;
    const file = await readWorkspaceFile(ownerId, chatId, item.path, { full: true });
    files.push({ path: file.path, content: file.content, revision: file.revision, sha256: file.sha256 });
  }
  return files;
}

export async function getWorkspaceStatus(ownerId, chatId) {
  const result = await listWorkspaceFiles(ownerId, chatId);
  return { workspaceId: `${String(chatId)}`, ...result, limits: { maxFiles: MAX_WORKSPACE_FILES, maxFileBytes: MAX_FILE_BYTES, maxWorkspaceBytes: MAX_WORKSPACE_BYTES } };
}


export async function deleteWorkspaceForChat(ownerId, chatId) {
  if (!ownerId || !chatId) return { deletedCount: 0 };
  if (databaseReady()) {
    const result = await WorkspaceFile.deleteMany({ ownerId: String(ownerId), chatId: String(chatId) });
    return { deletedCount: Number(result.deletedCount || 0) };
  }
  let deletedCount = 0;
  for (const [recordKey, file] of memoryFiles.entries()) {
    if (file.ownerId === String(ownerId) && file.chatId === String(chatId)) {
      memoryFiles.delete(recordKey);
      deletedCount++;
    }
  }
  return { deletedCount };
}

export function __resetWorkspaceMemoryForTests() { memoryFiles.clear(); }
