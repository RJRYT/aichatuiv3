import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateExecutionInput,
  EXECUTION_LIMITS,
  getVercelSandboxConfig,
} from '../src/services/interpreter/executionSchemas.js';
import { acquireExecution } from '../src/services/interpreter/executionQueue.js';

test('accepts valid Python source and normalizes execution and chat IDs', () => {
  const result = validateExecutionInput({
    code: 'print(2 + 2)',
    executionId: 'task-1'.repeat(30),
    chatId: 'chat-123',
  });
  assert.equal(result.code, 'print(2 + 2)');
  assert.equal(result.executionId.length, 100);
  assert.equal(result.chatId, 'chat-123');
});

test('rejects empty and oversized source', () => {
  assert.throws(() => validateExecutionInput({ code: '  ' }), /source code is required/);
  assert.throws(
    () => validateExecutionInput({ code: 'x'.repeat(EXECUTION_LIMITS.codeBytes + 1) }),
    /64 KB limit/
  );
});

test('enforces per-user and global concurrent execution quotas and releases slots', () => {
  const releaseA = acquireExecution('test-user');
  const releaseB = acquireExecution('test-user');
  assert.throws(() => acquireExecution('test-user'), /concurrent Python execution limit/);
  releaseA();
  const releaseC = acquireExecution('test-user');
  releaseB();
  releaseC();
});

test('Vercel Sandbox configuration requires complete external credentials and clamps resource limits', () => {
  assert.equal(getVercelSandboxConfig({}).configured, false);
  const config = getVercelSandboxConfig({
    VERCEL_TOKEN: 'token',
    VERCEL_TEAM_ID: 'team',
    VERCEL_PROJECT_ID: 'project',
    VERCEL_SANDBOX_TIMEOUT_MS: '999999999',
    VERCEL_SANDBOX_VCPUS: '99',
  });
  assert.equal(config.configured, true);
  assert.equal(config.authMode, 'access-token');
  assert.equal(config.timeoutMs, 45 * 60 * 1000);
  assert.equal(config.vcpus, 4);
  assert.equal(config.image, 'vercel/sandbox/python:3.14');
  assert.equal(config.networkMode, 'public');
});
