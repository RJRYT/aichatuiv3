import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { WorkspaceFile } from '../../models/WorkspaceFile.js';
import { getChat } from '../chatStore.js';
import { storeArtifact } from '../interpreter/artifactStore.js';
import { inspectZipBuffer } from '../archiveValidation.js';
import { deflateRawSync } from 'node:zlib';

const memoryFiles = new Map();
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_WORKSPACE_BYTES = 20 * 1024 * 1024;
const MAX_WORKSPACE_FILES = 500;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function databaseReady() {
  if (!process.env.MONGODB_URI) return false;
  if (mongoose.connection.readyState !== 1)
    throw Object.assign(
      new Error('MongoDB is temporarily unavailable; the persistent workspace cannot be accessed.'),
      { status: 503 }
    );
  return true;
}

export function normalizeWorkspacePath(raw) {
  const supplied = String(raw || '')
    .replaceAll('\\', '/')
    .trim();
  if (
    !supplied ||
    supplied.length > 500 ||
    supplied.startsWith('/') ||
    /^[a-zA-Z]:/.test(supplied)
  ) {
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
  if (databaseReady()) {
    return WorkspaceFile.findOne({ ownerId: String(ownerId), chatId: String(chatId), path }).lean();
  }
  return memoryFiles.get(key(ownerId, chatId, path)) || null;
}

async function listRecords(ownerId, chatId) {
  if (databaseReady()) {
    return WorkspaceFile.find({ ownerId: String(ownerId), chatId: String(chatId) })
      .select('path size revision sha256 createdAt updatedAt')
      .sort({ path: 1 })
      .lean();
  }
  return [...memoryFiles.values()].filter(
    (file) => file.ownerId === String(ownerId) && file.chatId === String(chatId)
  );
}

export async function listWorkspaceFiles(ownerId, chatId, prefix = '') {
  await assertWorkspace(ownerId, chatId);
  const normalizedPrefix = prefix ? normalizeWorkspacePath(prefix).replace(/\/$/, '') : '';
  const files = await listRecords(ownerId, chatId);
  return {
    files: files
      .filter(
        (file) =>
          !normalizedPrefix ||
          file.path === normalizedPrefix ||
          file.path.startsWith(`${normalizedPrefix}/`)
      )
      .map(({ path, size, revision, sha256, updatedAt }) => ({
        path,
        size,
        revision,
        sha256,
        updatedAt,
      })),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
  };
}

export async function readWorkspaceFile(ownerId, chatId, rawPath, options = {}) {
  await assertWorkspace(ownerId, chatId);
  const path = normalizeWorkspacePath(rawPath);
  const file = await findFile(ownerId, chatId, path);
  if (!file) throw new Error(`Workspace file not found: ${path}`);
  const allLines = String(file.content || '').split(/\r?\n/);
  const full = Boolean(options.full);
  const startLine = full ? 1 : Math.max(1, Number(options.startLine) || 1);
  const maxLines = full
    ? allLines.length
    : Math.max(1, Math.min(500, Number(options.maxLines) || 200));
  const selected = allLines.slice(startLine - 1, startLine - 1 + maxLines);
  const nextLine = startLine - 1 + selected.length + 1;
  return {
    path,
    content: selected.join('\n'),
    size: file.size,
    revision: file.revision,
    sha256: file.sha256,
    totalLines: allLines.length,
    startLine,
    nextLine: nextLine <= allLines.length ? nextLine : null,
    truncated: nextLine <= allLines.length,
    updatedAt: file.updatedAt,
  };
}

export async function createWorkspaceFile(
  ownerId,
  chatId,
  rawPath,
  content,
  { overwrite = false } = {}
) {
  await assertWorkspace(ownerId, chatId);
  const path = normalizeWorkspacePath(rawPath);
  const text = String(content ?? '');
  const size = Buffer.byteLength(text, 'utf8');
  if (size > MAX_FILE_BYTES) throw new Error('A workspace file cannot exceed 1 MB.');
  const existing = await findFile(ownerId, chatId, path);
  if (existing && !overwrite)
    throw new Error(
      `Workspace file already exists: ${path}. Use workspace_edit or explicitly enable overwrite.`
    );
  const files = await listRecords(ownerId, chatId);
  const total =
    files.reduce((sum, file) => sum + Number(file.size || 0), 0) -
    Number(existing?.size || 0) +
    size;
  if (!existing && files.length >= MAX_WORKSPACE_FILES)
    throw new Error('Workspace file limit reached (500 files).');
  if (total > MAX_WORKSPACE_BYTES) throw new Error('Workspace storage limit reached (20 MB).');
  const now = new Date();
  const record = {
    ownerId: String(ownerId),
    chatId: String(chatId),
    path,
    content: text,
    size,
    revision: Number(existing?.revision || 0) + 1,
    sha256: sha256(text),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (databaseReady()) {
    const saved = await WorkspaceFile.findOneAndUpdate(
      {
        ownerId: record.ownerId,
        chatId: record.chatId,
        path,
        ...(existing ? { revision: existing.revision } : {}),
      },
      { $set: record },
      { upsert: !existing, new: true, runValidators: true }
    );
    if (!saved)
      throw new Error(
        'Workspace file changed during this operation. Read the latest revision and retry.'
      );
  } else memoryFiles.set(key(ownerId, chatId, path), record);
  return { path, size, revision: record.revision, sha256: record.sha256, created: !existing };
}

export async function editWorkspaceFile(ownerId, chatId, rawPath, args = {}) {
  const current = await readWorkspaceFile(ownerId, chatId, rawPath, { full: true });
  if (args.expectedRevision != null && Number(args.expectedRevision) !== current.revision) {
    throw new Error(
      `Stale workspace edit for ${current.path}. Expected revision ${args.expectedRevision}, current revision is ${current.revision}. Read the file again before editing.`
    );
  }
  let next;
  if (args.mode === 'append') next = current.content + String(args.newText ?? '');
  else if (args.mode === 'replace') {
    const oldText = String(args.oldText ?? '');
    if (!oldText) throw new Error('Exact replacement requires non-empty oldText.');
    const first = current.content.indexOf(oldText);
    if (first < 0)
      throw new Error(
        'The exact oldText was not found. Read the current file and prepare a fresh edit.'
      );
    if (current.content.indexOf(oldText, first + oldText.length) >= 0 && !args.replaceAll) {
      throw new Error(
        'oldText matches more than once. Provide a more specific anchor or set replaceAll=true.'
      );
    }
    next = args.replaceAll
      ? current.content.split(oldText).join(String(args.newText ?? ''))
      : current.content.slice(0, first) +
        String(args.newText ?? '') +
        current.content.slice(first + oldText.length);
  } else if (args.mode === 'overwrite') next = String(args.content ?? '');
  else throw new Error('Edit mode must be append, replace, or overwrite.');
  return createWorkspaceFile(ownerId, chatId, current.path, next, { overwrite: true });
}

export async function deleteWorkspaceFile(ownerId, chatId, rawPath) {
  await assertWorkspace(ownerId, chatId);
  const path = normalizeWorkspacePath(rawPath);
  const existing = await findFile(ownerId, chatId, path);
  if (!existing) return { deleted: false, path };
  if (databaseReady())
    await WorkspaceFile.deleteOne({ ownerId: String(ownerId), chatId: String(chatId), path });
  else memoryFiles.delete(key(ownerId, chatId, path));
  return { deleted: true, path };
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
  const local = [],
    central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const compressed = deflateRawSync(content);
    const crc = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

export async function archiveWorkspace(ownerId, chatId, name = 'project.zip') {
  await assertWorkspace(ownerId, chatId);
  const records = (await listRecords(ownerId, chatId)).filter(
    (item) => !isSensitiveWorkspacePath(item.path)
  );
  if (!records.length) throw new Error('The workspace contains no non-secret files to archive.');
  const files = [];
  for (const item of records) {
    const full = await findFile(ownerId, chatId, item.path);
    files.push({ path: item.path, content: full.content });
  }
  const archive = createZip(files);
  const verification = inspectZipBuffer(archive);
  if (!verification.valid || verification.fileCount !== files.length)
    throw new Error(
      `Workspace archive verification failed: ${verification.reason || 'file count mismatch'}`
    );
  const safeName = String(name || 'project.zip')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 120);
  const filename = safeName.toLowerCase().endsWith('.zip') ? safeName : `${safeName}.zip`;
  const artifact = await storeArtifact({
    ownerId,
    chatId,
    name: filename,
    relativePath: filename,
    content: archive,
    mimeType: 'application/zip',
  });
  return {
    archived: true,
    verified: true,
    artifact,
    artifacts: [artifact],
    fileCount: files.length,
    totalBytes: archive.length,
    workspaceFiles: files.map((file) => file.path),
  };
}

function isSensitiveWorkspacePath(rawPath) {
  if (
    String(rawPath || '')
      .split('/')
      .includes('.git')
  )
    return true;
  const base = String(rawPath || '')
    .split('/')
    .at(-1)
    .toLowerCase();
  if (
    base === '.env' ||
    (base.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(base))
  )
    return true;
  return (
    [
      'id_rsa',
      'id_ed25519',
      'id_ecdsa',
      'credentials.json',
      'service-account.json',
      'authorized_keys',
      '.npmrc',
      '.pypirc',
      '.netrc',
      '.git-credentials',
      '.ds_store',
    ].includes(base) || /\.(pem|key|p12|pfx)$/i.test(base)
  );
}

export async function getWorkspaceSnapshot(ownerId, chatId) {
  const listing = await listWorkspaceFiles(ownerId, chatId);
  const files = [];
  for (const item of listing.files) {
    if (isSensitiveWorkspacePath(item.path)) continue;
    const file = await readWorkspaceFile(ownerId, chatId, item.path, { full: true });
    files.push({
      path: file.path,
      content: file.content,
      revision: file.revision,
      sha256: file.sha256,
    });
  }
  return files;
}

export async function getWorkspaceStatus(ownerId, chatId) {
  const result = await listWorkspaceFiles(ownerId, chatId);
  return {
    workspaceId: `${String(chatId)}`,
    ...result,
    limits: {
      maxFiles: MAX_WORKSPACE_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      maxWorkspaceBytes: MAX_WORKSPACE_BYTES,
    },
  };
}

export async function deleteWorkspaceForChat(ownerId, chatId) {
  if (!ownerId || !chatId) return { deletedCount: 0 };
  if (databaseReady()) {
    const result = await WorkspaceFile.deleteMany({
      ownerId: String(ownerId),
      chatId: String(chatId),
    });
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

export function __resetWorkspaceMemoryForTests() {
  memoryFiles.clear();
}
