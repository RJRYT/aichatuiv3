import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExecutionInput, EXECUTION_LIMITS } from '../src/services/interpreter/executionSchemas.js';
import { acquireExecution } from '../src/services/interpreter/executionQueue.js';

test('accepts valid Python source and normalizes execution IDs', () => {
  const result = validateExecutionInput({ code: 'print(2 + 2)', executionId: 'task-1'.repeat(30) });
  assert.equal(result.code, 'print(2 + 2)');
  assert.equal(result.executionId.length, 100);
});
test('rejects empty and oversized source', () => {
  assert.throws(() => validateExecutionInput({ code: '  ' }), /source code is required/);
  assert.throws(() => validateExecutionInput({ code: 'x'.repeat(EXECUTION_LIMITS.codeBytes + 1) }), /64 KB limit/);
});
test('enforces per-user concurrent execution quota and releases slots', () => {
  const releaseA = acquireExecution('test-user');
  const releaseB = acquireExecution('test-user');
  assert.throws(() => acquireExecution('test-user'), /concurrent Python execution limit/);
  releaseA();
  const releaseC = acquireExecution('test-user');
  releaseB(); releaseC();
});

test('Monty runtime settings are clamped and checkout can wait for a single worker feed', async () => {
  const { getMontyRuntimeConfig } = await import('../src/services/interpreter/executionSchemas.js');
  assert.deepEqual(getMontyRuntimeConfig({}), {
    maxProcesses: 1,
    maxMemory: 32 * 1024 * 1024,
    maxFeedDurationSecs: 12,
    checkoutTimeoutSeconds: 17
  });
  assert.deepEqual(getMontyRuntimeConfig({
    MONTY_MAX_WORKERS: '99',
    MONTY_MAX_MEMORY_BYTES: '1',
    MONTY_MAX_FEED_SECONDS: '99'
  }), {
    maxProcesses: 4,
    maxMemory: 8 * 1024 * 1024,
    maxFeedDurationSecs: 30,
    checkoutTimeoutSeconds: 35
  });
});
