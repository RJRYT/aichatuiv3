import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRetrievedChat } from '../src/services/conversationPrivacy.js';

test('legacy reasoning is stripped from messages, branches, and response versions', () => {
  const sanitized = sanitizeRetrievedChat({
    messages: [
      { role: 'assistant', content: 'Visible answer', reasoning: 'private chain of thought' },
      {
        role: 'assistant',
        content: 'Versioned answer',
        reasoning: 'private thought',
        versions: [
          { content: 'old version', reasoning: 'old private thought' },
          { content: 'new version', reasoning: 'new private thought' },
        ],
      },
    ],
    branches: [
      {
        branchId: 'main',
        messages: [{ role: 'assistant', content: 'Branch answer', reasoning: 'private branch thought' }],
      },
    ],
  });
  assert.equal('reasoning' in sanitized.messages[0], false);
  assert.equal('reasoning' in sanitized.messages[1], false);
  assert.equal('reasoning' in sanitized.messages[1].versions[0], false);
  assert.equal('reasoning' in sanitized.branches[0].messages[0], false);
  assert.equal(sanitized.messages[0].content, 'Visible answer');
});
