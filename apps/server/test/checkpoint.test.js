import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, deleteChat } from '../src/services/chatStore.js';
import {
  __resetAgentCheckpointMemoryForTests,
  createAgentCheckpoint,
  finishAgentCheckpoint,
  getLatestAgentCheckpoint,
  updateAgentCheckpoint,
} from '../src/services/agents/checkpointManager.js';

test('agent checkpoints persist run state and completed operation summaries in memory mode', async () => {
  const oldMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  __resetAgentCheckpointMemoryForTests();
  const chat = await createChat('checkpoint-owner', 'Checkpoint test');
  try {
    const created = await createAgentCheckpoint({ ownerId: 'checkpoint-owner', chatId: String(chat._id), plan: { objective: 'Build a project', tasks: [] } });
    assert.equal(created.status, 'running');
    await updateAgentCheckpoint('checkpoint-owner', created.runId, {
      round: 3,
      executionToolCalls: 2,
      operation: { tool: 'workspace_create', status: 'completed', arguments: { path: 'index.html' } },
    });
    await finishAgentCheckpoint('checkpoint-owner', created.runId, 'interrupted', 'Model timeout');
    const latest = await getLatestAgentCheckpoint('checkpoint-owner', String(chat._id));
    assert.equal(latest.status, 'interrupted');
    assert.equal(latest.round, 3);
    assert.equal(latest.executionToolCalls, 2);
    assert.equal(latest.completedOperations.length, 1);
    assert.equal(latest.lastError, 'Model timeout');
  } finally {
    await deleteChat('checkpoint-owner', String(chat._id));
    __resetAgentCheckpointMemoryForTests();
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});


test('completed agent checkpoints remain available as project history for later turns', async () => {
  const oldMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  __resetAgentCheckpointMemoryForTests();
  const chat = await createChat('checkpoint-history-owner', 'Project history test');
  try {
    const created = await createAgentCheckpoint({
      ownerId: 'checkpoint-history-owner',
      chatId: String(chat._id),
      plan: { objective: 'Implement project milestones', tasks: [{ id: 'p1', title: 'Foundation', status: 'completed' }] },
    });
    await updateAgentCheckpoint('checkpoint-history-owner', created.runId, {
      plan: { objective: 'Implement project milestones', tasks: [{ id: 'p1', title: 'Foundation', status: 'completed' }] },
      operation: { tool: 'workspace_create', status: 'completed', arguments: { path: 'README.md' } },
    });
    await finishAgentCheckpoint('checkpoint-history-owner', created.runId, 'completed');
    const history = await getLatestAgentCheckpoint('checkpoint-history-owner', String(chat._id));
    assert.equal(history.status, 'completed');
    assert.equal(history.plan.tasks[0].status, 'completed');
    assert.equal(history.completedOperations[0].arguments.path, 'README.md');
  } finally {
    await deleteChat('checkpoint-history-owner', String(chat._id));
    __resetAgentCheckpointMemoryForTests();
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});
