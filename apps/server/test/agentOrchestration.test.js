import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUserRequest, collectVerifiedArtifacts, sanitizeAssistantText } from '../src/services/agentOrchestration.js';
import { sanitizeChatForRead } from '../src/services/agentOrchestration.js';

test('detects complex project and ZIP deliverable requests', () => {
  const intent = classifyUserRequest([{ role: 'user', content: 'Build a pure html website of task manager and zip all files and send it to me.' }]);
  assert.equal(intent.deliverable, true);
  assert.equal(intent.complex, true);
  assert.equal(intent.wantsZip, true);
});

test('detects simple file deliverables but not capability questions', () => {
  assert.equal(classifyUserRequest([{ role: 'user', content: 'Generate 3 simple JSON files and zip them.' }]).deliverable, true);
  assert.equal(classifyUserRequest([{ role: 'user', content: 'Can you download images from internet?' }]).deliverable, false);
  assert.equal(classifyUserRequest([{ role: 'user', content: 'Give it as file.' }]).deliverable, true);
  assert.equal(classifyUserRequest([{ role: 'user', content: 'Fetch image from https://example.com/image.png' }]).deliverable, true);
});

test('only accepts artifacts with real metadata and a checksum', () => {
  const result = collectVerifiedArtifacts([{ result: { artifacts: [
    { id: 'real-id', name: 'site.zip', size: 100, sha256: 'a'.repeat(64), downloadUrl: '/internal' },
    { id: 'fake-id', name: 'fake.zip', size: 100 },
    { id: '', name: 'empty.zip', size: 0, sha256: 'b'.repeat(64) },
  ] } }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'site.zip');
  assert.equal('downloadUrl' in result[0], false);
});

test('removes private reasoning and internal artifact paths', () => {
  assert.equal(sanitizeAssistantText('Download: /api/interpreter/artifacts/abc123'), 'Download: [download available in the File Library]');
});

test('historical chat serialization strips reasoning and internal artifact URLs from messages and versions', () => {
  const chat = sanitizeChatForRead({
    messages: [{ role: 'assistant', content: 'done /api/interpreter/artifacts/fake123', reasoning: 'private', toolEvents: [{ result: { artifacts: [{ id: 'a', name: 'a.zip', downloadUrl: '/api/interpreter/artifacts/a' }] } }], versions: [{ content: 'old', reasoning: 'private version' }] }],
    branches: [{ branchId: 'main', messages: [{ role: 'assistant', content: 'branch', reasoning: 'private branch' }] }],
  });
  assert.equal('reasoning' in chat.messages[0], false);
  assert.equal(chat.messages[0].content, 'done [download available in the File Library]');
  assert.equal('reasoning' in chat.messages[0].versions[0], false);
  assert.equal('downloadUrl' in chat.messages[0].toolEvents[0].result.artifacts[0], false);
  assert.equal('reasoning' in chat.branches[0].messages[0], false);
});
