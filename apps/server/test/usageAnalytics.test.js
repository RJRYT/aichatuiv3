import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsageFromChats } from '../src/services/usageAnalytics.js';

test('usage analytics hydrates branch messages and totals real model usage', () => {
  const now = Date.parse('2026-11-23T12:00:00.000Z');
  const chats = [
    {
      _id: 'chat-1',
      activeBranchId: 'main',
      messages: [
        { role: 'user', content: 'Build something', createdAt: '2026-11-23T10:00:00.000Z' },
        {
          role: 'assistant',
          content: 'Done',
          createdAt: '2026-11-23T10:01:00.000Z',
          durationMs: 60000,
          toolEvents: [{ name: 'workspace_create' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          modelCallsByModel: { bolt: 1, surge: 3 },
          usageByModel: {
            bolt: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            surge: { prompt_tokens: 90, completion_tokens: 45, total_tokens: 135 },
          },
        },
      ],
    },
  ];
  const result = aggregateUsageFromChats(chats, 7, now);
  assert.equal(result.totals.chats, 1);
  assert.equal(result.totals.userMessages, 1);
  assert.equal(result.totals.assistantMessages, 1);
  assert.equal(result.totals.toolCalls, 1);
  assert.equal(result.totals.promptTokens, 100);
  assert.equal(result.totals.completionTokens, 50);
  assert.equal(result.totals.totalTokens, 150);
  assert.equal(result.modelUsage.bolt.totalTokens, 15);
  assert.equal(result.modelUsage.surge.totalTokens, 135);
  assert.equal(result.modelUsage.surge.requests, 3);
  assert.equal(result.totals.avgResponseMs, 60000);
  assert.equal(result.totals.legacyUsageMessages, 0);
});

test('usage analytics counts unique responses from inactive branches without double-counting inherited messages', () => {
  const now = Date.parse('2026-11-23T12:00:00.000Z');
  const baseUser = { id: 'u1', role: 'user', createdAt: '2026-11-23T09:00:00.000Z' };
  const baseAssistant = {
    id: 'a1',
    role: 'assistant',
    createdAt: '2026-11-23T09:01:00.000Z',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    model: { alias: 'bolt' },
  };
  const branchAssistant = {
    id: 'a2',
    role: 'assistant',
    createdAt: '2026-11-23T10:00:00.000Z',
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    model: { alias: 'surge' },
  };
  const chat = {
    activeBranchId: 'main',
    messages: [baseUser, baseAssistant],
    branches: [
      { branchId: 'main', parentBranchId: null, messages: [baseUser, baseAssistant] },
      {
        branchId: 'alternate',
        parentBranchId: 'main',
        forkedFromMessageId: 'a1',
        messages: [branchAssistant],
      },
    ],
  };
  const result = aggregateUsageFromChats([chat], 7, now);
  assert.equal(result.totals.assistantMessages, 2);
  assert.equal(result.totals.totalTokens, 45);
  assert.equal(result.modelUsage.bolt.totalTokens, 15);
  assert.equal(result.modelUsage.surge.totalTokens, 30);
});

test('usage analytics includes every regenerated response version', () => {
  const now = Date.parse('2026-11-23T12:00:00.000Z');
  const chat = {
    activeBranchId: 'main',
    messages: [
      {
        id: 'assistant-versioned',
        role: 'assistant',
        createdAt: '2026-11-23T09:00:00.000Z',
        activeVersion: 1,
        content: 'Second version',
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        versions: [
          {
            createdAt: '2026-11-23T09:00:00.000Z',
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            model: { alias: 'bolt' },
            modelCallsByModel: { bolt: 1 },
          },
          {
            createdAt: '2026-11-23T10:00:00.000Z',
            usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
            model: { alias: 'surge' },
            modelCallsByModel: { surge: 2 },
          },
        ],
      },
    ],
  };
  const result = aggregateUsageFromChats([chat], 7, now);
  assert.equal(result.totals.assistantMessages, 2);
  assert.equal(result.totals.totalTokens, 65);
  assert.equal(result.modelUsage.bolt.totalTokens, 15);
  assert.equal(result.modelUsage.surge.totalTokens, 50);
  assert.equal(result.modelUsage.surge.requests, 2);
});
