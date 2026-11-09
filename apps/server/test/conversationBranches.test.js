import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureBranches,
  getBranchMessages,
  createBranch,
  setBranchMessages,
} from '../src/services/conversationBranches.js';

const base = () => ({
  messages: [
    { id: 'u1', role: 'user', content: 'hello' },
    { id: 'a1', role: 'assistant', content: 'hi' },
    { id: 'u2', role: 'user', content: 'next' },
  ],
  branches: [],
  activeBranchId: 'main',
});

test('migrates legacy flat messages to a root branch without changing history', () => {
  const chat = base();
  ensureBranches(chat);
  assert.equal(chat.branches[0].branchId, 'main');
  assert.deepEqual(getBranchMessages(chat, 'main'), chat.messages);
});

test('creates branches with a shared prefix and independent suffix', () => {
  const chat = base();
  ensureBranches(chat);
  const { branch, messages } = createBranch(chat, {
    fromBranchId: 'main',
    forkedFromMessageId: 'a1',
    messages: [{ id: 'u-edit', role: 'user', content: 'edited' }],
  });
  assert.deepEqual(
    messages.map((m) => m.id),
    ['u1', 'a1', 'u-edit']
  );
  assert.deepEqual(
    chat.branches.find((b) => b.branchId === branch.branchId).messages.map((m) => m.id),
    ['u-edit']
  );
  assert.deepEqual(
    getBranchMessages(chat, branch.branchId).map((m) => m.id),
    ['u1', 'a1', 'u-edit']
  );
});

test('supports a new root branch for editing the first message', () => {
  const chat = base();
  ensureBranches(chat);
  const { branch, messages } = createBranch(chat, {
    fromBranchId: 'main',
    forkedFromMessageId: null,
    messages: [{ id: 'replacement', role: 'user', content: 'new start' }],
  });
  assert.equal(branch.parentBranchId, null);
  assert.deepEqual(
    messages.map((m) => m.id),
    ['replacement']
  );
});

test('updates only the branch suffix after its shared prefix', () => {
  const chat = base();
  ensureBranches(chat);
  const { branch } = createBranch(chat, {
    fromBranchId: 'main',
    forkedFromMessageId: 'a1',
    messages: [{ id: 'u-edit', role: 'user', content: 'edited' }],
  });
  const next = getBranchMessages(chat, branch.branchId);
  next.push({ id: 'a2', role: 'assistant', content: 'new answer' });
  setBranchMessages(chat, branch.branchId, next);
  assert.deepEqual(
    branch.messages.map((m) => m.id),
    ['u-edit', 'a2']
  );
  assert.equal(chat.messages.length, 3);
});

test('keeps the main branch in the legacy messages field instead of duplicating it', () => {
  const chat = base();
  ensureBranches(chat);
  setBranchMessages(chat, 'main', [
    ...chat.messages,
    { id: 'a2', role: 'assistant', content: 'answer' },
  ]);
  assert.equal(chat.branches.find((b) => b.branchId === 'main').messages.length, 0);
  assert.equal(chat.messages.length, 4);
  assert.equal(getBranchMessages(chat, 'main').length, 4);
});

test('supports nested branches while retaining each ancestor prefix once', () => {
  const chat = base();
  ensureBranches(chat);
  const first = createBranch(chat, {
    fromBranchId: 'main',
    forkedFromMessageId: 'a1',
    messages: [{ id: 'u3', role: 'user', content: 'branch one' }],
  });
  const second = createBranch(chat, {
    fromBranchId: first.branch.branchId,
    forkedFromMessageId: 'u3',
    messages: [{ id: 'a3', role: 'assistant', content: 'branch two' }],
  });
  assert.deepEqual(
    getBranchMessages(chat, second.branch.branchId).map((m) => m.id),
    ['u1', 'a1', 'u3', 'a3']
  );
  assert.deepEqual(
    second.branch.messages.map((m) => m.id),
    ['a3']
  );
});
