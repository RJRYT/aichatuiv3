import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatExport, chatExportFilename } from '../../client/src/chatExport.js';

test('chat export filename uses a lowercase hyphenated chat title', () => {
  assert.equal(chatExportFilename('My New Chat'), 'my-new-chat.json');
  assert.equal(chatExportFilename('Crème brûlée!'), 'creme-brulee.json');
  assert.equal(chatExportFilename('   '), 'chat.json');
});

test('chat export includes elapsed, assistant, and tool timing', () => {
  const startedAt = '2026-11-18T02:00:00.000Z';
  const completedAt = '2026-11-18T02:00:03.250Z';
  const exported = buildChatExport({
    title: 'Timed Chat',
    createdAt: startedAt,
    updatedAt: completedAt,
    exportedAt: '2026-11-18T02:01:00.000Z',
    messages: [
      { id: 'user-1', role: 'user', content: 'Begin', createdAt: startedAt },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Finished' }],
        startedAt,
        completedAt,
        durationMs: 3250,
        toolEvents: [
          {
            name: 'execute_python',
            startedAt,
            completedAt,
            durationMs: 2100,
          },
        ],
        agentEvents: [{ type: 'plan_created' }],
      },
    ],
  });

  assert.deepEqual(exported.timing, {
    startedAt,
    lastActivityAt: completedAt,
    elapsedMs: 3250,
    assistantWorkedMs: 3250,
    toolWorkedMs: 2100,
  });
  assert.equal(exported.messages[1].content, 'Finished');
  assert.equal(exported.messages[1].completedAt, completedAt);
  assert.equal(exported.messages[1].toolEvents[0].durationMs, 2100);
  assert.deepEqual(exported.messages[1].agentEvents, [{ type: 'plan_created' }]);
});

test('chat export counts in-progress assistant and tool work through export time', () => {
  const startedAt = '2026-11-18T02:00:00.000Z';
  const exportedAt = '2026-11-18T02:18:00.000Z';
  const toolStartedAt = '2026-11-18T02:00:40.000Z';
  const exported = buildChatExport({
    createdAt: startedAt,
    updatedAt: startedAt,
    exportedAt,
    messages: [
      {
        role: 'assistant',
        isStreaming: true,
        startedAt,
        toolEvents: [{ name: 'execute_python', status: 'running', startedAt: toolStartedAt }],
      },
    ],
  });

  assert.equal(exported.timing.lastActivityAt, exportedAt);
  assert.equal(exported.timing.elapsedMs, 18 * 60 * 1000);
  assert.equal(exported.timing.assistantWorkedMs, 18 * 60 * 1000);
  assert.equal(exported.timing.toolWorkedMs, (17 * 60 + 20) * 1000);
});
