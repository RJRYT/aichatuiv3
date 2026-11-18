import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createChat,
  deleteChat,
  getChat,
  searchChatContexts,
  updateChat,
} from '../src/services/chatStore.js';

test('previous-chat search returns only matching context owned by the requested account', async () => {
  const sessionId = `history-search-${randomUUID()}`;
  const otherSessionId = `history-search-other-${randomUUID()}`;
  const chat = await createChat(sessionId, 'Migration discussion');
  const otherChat = await createChat(otherSessionId, 'Migration discussion');
  try {
    await updateChat(sessionId, chat._id, {
      messages: [
        { id: 'user-1', role: 'user', content: 'We chose PostgreSQL for the migration.' },
        { id: 'assistant-1', role: 'assistant', content: 'I will use PostgreSQL in the plan.' },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Visible response',
          reasoning: 'private reasoning must not be returned',
        },
      ],
    });

    await updateChat(otherSessionId, otherChat._id, {
      messages: [
        { id: 'other-user', role: 'user', content: 'PostgreSQL details for another user' },
      ],
    });

    const results = await searchChatContexts(sessionId, 'PostgreSQL');
    assert.equal(results.length, 1);
    assert.equal(results[0].chatId, String(chat._id));
    assert.deepEqual(
      results[0].messages.map((message) => message.content),
      ['We chose PostgreSQL for the migration.', 'I will use PostgreSQL in the plan.']
    );
    assert.deepEqual(await searchChatContexts(sessionId, 'x'), []);
    assert.deepEqual(
      await searchChatContexts(sessionId, 'PostgreSQL', { excludeChatId: chat._id }),
      []
    );
  } finally {
    await deleteChat(sessionId, chat._id);
    await deleteChat(otherSessionId, otherChat._id);
  }
});

test('chat persistence preserves message, tool, and response-version timing metadata', async () => {
  const sessionId = `history-timing-${randomUUID()}`;
  const chat = await createChat(sessionId, 'Timing metadata');
  const startedAt = '2026-11-18T02:00:00.000Z';
  const completedAt = '2026-11-18T02:00:03.250Z';
  try {
    await updateChat(sessionId, chat._id, {
      messages: [
        {
          id: 'user-timed',
          role: 'user',
          content: 'Do a timed task',
          createdAt: startedAt,
        },
        {
          id: 'assistant-timed',
          role: 'assistant',
          content: 'Done',
          startedAt,
          createdAt: startedAt,
          completedAt,
          durationMs: 3250,
          toolEvents: [
            {
              name: 'execute_python',
              status: 'complete',
              startedAt,
              completedAt,
              durationMs: 2100,
            },
          ],
          agentEvents: [{ type: 'plan_created', at: startedAt }],
          versions: [
            {
              content: 'Alternate answer',
              startedAt,
              createdAt: startedAt,
              completedAt,
              durationMs: 1800,
              agentEvents: [{ type: 'agent_completed', at: completedAt }],
            },
          ],
        },
      ],
    });

    const stored = await getChat(sessionId, chat._id);
    assert.equal(stored.messages[0].createdAt, startedAt);
    assert.equal(stored.messages[1].startedAt, startedAt);
    assert.equal(stored.messages[1].completedAt, completedAt);
    assert.equal(stored.messages[1].durationMs, 3250);
    assert.equal(stored.messages[1].toolEvents[0].durationMs, 2100);
    assert.equal(stored.messages[1].toolEvents[0].startedAt, startedAt);
    assert.equal(stored.messages[1].agentEvents[0].at, startedAt);
    assert.equal(stored.messages[1].versions[0].durationMs, 1800);
    assert.equal(stored.messages[1].versions[0].agentEvents[0].at, completedAt);
  } finally {
    await deleteChat(sessionId, chat._id);
  }
});
