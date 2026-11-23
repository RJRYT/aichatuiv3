import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, deleteChat } from '../src/services/chatStore.js';
import { deleteArtifacts, getArtifact } from '../src/services/interpreter/artifactStore.js';
import {
  __resetWorkspaceMemoryForTests,
  archiveWorkspace,
  exportWorkspaceFile,
  createWorkspaceFile,
  deleteWorkspaceFile,
  editWorkspaceFile,
  getWorkspaceSnapshot,
  getWorkspaceStatus,
  listWorkspaceFiles,
  normalizeWorkspacePath,
  readWorkspaceFile,
  searchWorkspaceFiles,
} from '../src/services/workspace/workspaceManager.js';

const ownerId = 'workspace-test-owner';

test('workspace paths reject traversal and allow normal project dotfiles', () => {
  assert.equal(normalizeWorkspacePath('src/components/App.jsx'), 'src/components/App.jsx');
  assert.equal(normalizeWorkspacePath('.env.example'), '.env.example');
  assert.equal(normalizeWorkspacePath('.gitignore'), '.gitignore');
  assert.throws(() => normalizeWorkspacePath('../secret'), /relative|traversal/i);
  assert.throws(() => normalizeWorkspacePath('src/../../secret'), /traversal/i);
  assert.throws(() => normalizeWorkspacePath('/etc/passwd'), /relative/i);
});

test('workspace supports create, read, revision-aware edit, search and delete', async () => {
  const oldMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  __resetWorkspaceMemoryForTests();
  const chat = await createChat(ownerId, 'Workspace test');
  try {
    const created = await createWorkspaceFile(ownerId, String(chat._id), 'src/App.jsx', 'export default function App() { return <main>Hi</main>; }');
    assert.equal(created.created, true);
    const first = await readWorkspaceFile(ownerId, String(chat._id), 'src/App.jsx');
    assert.equal(first.revision, 1);
    await assert.rejects(editWorkspaceFile(ownerId, String(chat._id), 'src/App.jsx', { mode: 'replace', oldText: 'missing', newText: 'x' }), /not found/i);
    const edited = await editWorkspaceFile(ownerId, String(chat._id), 'src/App.jsx', { mode: 'replace', oldText: 'Hi', newText: 'Hello', expectedRevision: 1 });
    assert.equal(edited.revision, 2);
    await assert.rejects(editWorkspaceFile(ownerId, String(chat._id), 'src/App.jsx', { mode: 'append', newText: '!', expectedRevision: 1 }), /Stale workspace edit/i);
    const found = await searchWorkspaceFiles(ownerId, String(chat._id), 'Hello');
    assert.equal(found.results.length, 1);
    assert.equal((await getWorkspaceStatus(ownerId, String(chat._id))).fileCount, 1);
    assert.equal((await getWorkspaceSnapshot(ownerId, String(chat._id))).length, 1);
    assert.equal((await deleteWorkspaceFile(ownerId, String(chat._id), 'src/App.jsx')).deleted, true);
    assert.equal((await listWorkspaceFiles(ownerId, String(chat._id))).fileCount, 0);
  } finally {
    await deleteChat(ownerId, String(chat._id));
    __resetWorkspaceMemoryForTests();
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});

test('workspace archive creates a stored ZIP with a verified manifest', async () => {
  const oldMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  __resetWorkspaceMemoryForTests();
  const chat = await createChat(ownerId, 'Archive test');
  let artifactId;
  try {
    await createWorkspaceFile(ownerId, String(chat._id), 'index.html', '<!doctype html><title>Test</title>');
    await createWorkspaceFile(ownerId, String(chat._id), 'src/app.js', 'console.log("ok")');
    await createWorkspaceFile(ownerId, String(chat._id), '.env', 'SECRET=value');
    await createWorkspaceFile(ownerId, String(chat._id), '.env.example', 'PUBLIC_EXAMPLE=value');
    const snapshot = await getWorkspaceSnapshot(ownerId, String(chat._id));
    assert.equal(snapshot.some((file) => file.path === '.env'), false);
    assert.equal(snapshot.some((file) => file.path === '.env.example'), true);
    const result = await archiveWorkspace(ownerId, String(chat._id), 'site.zip');
    artifactId = result.artifact.id;
    assert.equal(result.verified, true);
    assert.equal(result.archiveValid, true);
    assert.equal(result.contentVerified, true);
    assert.equal(result.projectComplete, null);
    assert.equal(result.fileCount, 3);
    const artifact = await getArtifact(artifactId, ownerId);
    assert.equal(artifact.mimeType, 'application/zip');
    assert.ok(artifact.data.length > 22);
  } finally {
    if (artifactId) await deleteArtifacts([artifactId], ownerId);
    await deleteChat(ownerId, String(chat._id));
    __resetWorkspaceMemoryForTests();
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});

test('workspace export creates a downloadable artifact for a single deliverable', async () => {
  const oldMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  __resetWorkspaceMemoryForTests();
  const chat = await createChat(ownerId, 'Export test');
  let artifactId;
  try {
    const source = '<!doctype html><html><body><h1>Download me</h1></body></html>';
    await createWorkspaceFile(ownerId, String(chat._id), 'site/index.html', source);
    const result = await exportWorkspaceFile(ownerId, String(chat._id), 'site/index.html');
    artifactId = result.artifact.id;
    assert.equal(result.exported, true);
    assert.equal(result.path, 'site/index.html');
    assert.equal(result.size, Buffer.byteLength(source, 'utf8'));
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].name, 'index.html');
    assert.ok(result.artifacts[0].downloadUrl.includes('/api/interpreter/artifacts/'));
    const stored = await getArtifact(artifactId, ownerId);
    assert.equal(stored.data.toString('utf8'), source);
    assert.equal(stored.mimeType, 'text/html');
  } finally {
    if (artifactId) await deleteArtifacts([artifactId], ownerId);
    await deleteChat(ownerId, String(chat._id));
    __resetWorkspaceMemoryForTests();
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});


test('workspace derives directories and rejects file/directory path collisions', async () => {
  const oldMongo = process.env.MONGODB_URI; delete process.env.MONGODB_URI; __resetWorkspaceMemoryForTests();
  const chat = await createChat(ownerId, 'Directory semantics test');
  try {
    await createWorkspaceFile(ownerId, String(chat._id), 'packages/backend/src/app.js', 'export default 1;');
    const listing = await listWorkspaceFiles(ownerId, String(chat._id));
    assert.ok(listing.directories.some((entry) => entry.path === 'packages' && entry.type === 'directory'));
    assert.ok(listing.directories.some((entry) => entry.path === 'packages/backend/src'));
    await assert.rejects(createWorkspaceFile(ownerId, String(chat._id), 'packages', 'not a directory'), /directory already exists/i);
    await assert.rejects(readWorkspaceFile(ownerId, String(chat._id), 'packages'), /is a directory/i);
    const removed = await deleteWorkspaceFile(ownerId, String(chat._id), 'packages');
    assert.equal(removed.recursive, true);
    assert.equal((await listWorkspaceFiles(ownerId, String(chat._id))).fileCount, 0);
  } finally {
    await deleteChat(ownerId, String(chat._id)); __resetWorkspaceMemoryForTests();
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});
