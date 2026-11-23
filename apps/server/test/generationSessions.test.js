import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendGenerationEvent, createGenerationSession, finishGenerationSession, getGenerationEvents, getGenerationSession } from '../src/services/generationSessions.js';

test('generation sessions persist ordered events and support replay after a cursor', async () => {
  const oldMongo = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  const generationId = randomUUID();
  const ownerId = 'generation-test-owner';
  try {
    await createGenerationSession({ generationId, ownerId, chatId: 'generation-test-chat' });
    await appendGenerationEvent(generationId, ownerId, { eventId: 1, type: 'chunk', content: 'Hello' });
    await appendGenerationEvent(generationId, ownerId, { eventId: 2, type: 'done' });
    await finishGenerationSession(generationId, ownerId, 'completed');
    const replay = await getGenerationEvents(generationId, ownerId, 1);
    assert.equal(replay.status, 'completed');
    assert.deepEqual(replay.events.map((event) => event.eventId), [2]);
    assert.equal((await getGenerationSession(generationId, ownerId)).status, 'completed');
    assert.equal(await getGenerationSession(generationId, 'another-owner'), null);
  } finally {
    if (oldMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = oldMongo;
  }
});
