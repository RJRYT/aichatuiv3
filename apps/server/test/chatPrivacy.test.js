import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRetrievedChat, sanitizeAgentPlan } from '../src/services/conversationPrivacy.js';

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
        messages: [
          { role: 'assistant', content: 'Branch answer', reasoning: 'private branch thought' },
        ],
      },
    ],
  });
  assert.equal('reasoning' in sanitized.messages[0], false);
  assert.equal('reasoning' in sanitized.messages[1], false);
  assert.equal('reasoning' in sanitized.messages[1].versions[0], false);
  assert.equal('reasoning' in sanitized.branches[0].messages[0], false);
  assert.equal(sanitized.messages[0].content, 'Visible answer');
});

test('execution plans are safely normalized for persistence and follow-up turns', () => {
  const plan = sanitizeAgentPlan({
    objective: 'Continue a website build',
    tasks: [
      {
        id: 'design',
        title: 'Design',
        description: 'Plan the interface',
        status: 'completed',
        dependsOn: [],
      },
      {
        id: 'build',
        title: 'Build',
        description: 'Implement the interface',
        status: 'running',
        dependsOn: ['design'],
      },
      {
        id: 'bad',
        title: 'Invalid status',
        description: 'Normalize status',
        status: 'private-state',
        dependsOn: [],
      },
    ],
  });
  assert.equal(plan.objective, 'Continue a website build');
  assert.equal(plan.tasks[0].status, 'completed');
  assert.equal(plan.tasks[1].status, 'running');
  assert.equal(plan.tasks[1].dependsOn[0], 'design');
  assert.equal(plan.tasks[2].status, 'pending');
  assert.equal(sanitizeAgentPlan(null), null);
});
