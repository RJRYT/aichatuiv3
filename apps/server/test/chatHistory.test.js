import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createChat,
  deleteChat,
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
      messages: [{ id: 'other-user', role: 'user', content: 'PostgreSQL details for another user' }],
    });

    const results = await searchChatContexts(sessionId, 'PostgreSQL');
    assert.equal(results.length, 1);
    assert.equal(results[0].chatId, String(chat._id));
    assert.deepEqual(
      results[0].messages.map((message) => message.content),
      ['We chose PostgreSQL for the migration.', 'I will use PostgreSQL in the plan.']
    );
    assert.deepEqual(await searchChatContexts(sessionId, 'x'), []);
    assert.deepEqual(await searchChatContexts(sessionId, 'PostgreSQL', { excludeChatId: chat._id }), []);
  } finally {
    await deleteChat(sessionId, chat._id);
    await deleteChat(otherSessionId, otherChat._id);
  }
});
