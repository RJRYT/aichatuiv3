import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeWithMonty, cancelExecution } from '../src/services/interpreter/sandboxManager.js';
import { getArtifact, deleteArtifacts } from '../src/services/interpreter/artifactStore.js';

function fakePool(feedRun) {
  let checkoutOptions;
  const session = {
    async feedRun(code, options) {
      return feedRun(code, options);
    },
    async close() {}
  };
  return {
    pool: {
      async checkout(options) {
        checkoutOptions = options;
        return session;
      }
    },
    getCheckoutOptions: () => checkoutOptions
  };
}

test('Monty provider captures output, returns a result and exposes only bounded host functions', async () => {
  const fake = fakePool(async (code, options) => {
    assert.equal(code, 'print("hello")\n40 + 2');
    assert.deepEqual(Object.keys(options.externalLookup).sort(), ['check_cancelled', 'create_artifact']);
    options.printCallback('stdout', 'hello\n');
    options.printCallback('stderr', 'diagnostic\n');
    await options.externalLookup.check_cancelled();
    const artifact = await options.externalLookup.create_artifact('result', 'hello artifact', 'text/plain');
    assert.equal(artifact.name, 'result.txt');
    return 42;
  });

  const result = await executeWithMonty({
    code: 'print("hello")\n40 + 2', userId: 'monty-test-user', executionId: 'monty-success',
    getPool: async () => fake.pool
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.result, 42);
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.stderr, 'diagnostic\n');
  assert.equal(result.provider, 'pydantic-monty-wasm');
  assert.equal(fake.getCheckoutOptions().limits.maxMemory, 32 * 1024 * 1024);
  assert.equal(result.artifacts.length, 1);

  const artifact = getArtifact(result.artifacts[0].id, 'monty-test-user');
  assert.ok(artifact);
  assert.equal(await readFile(artifact.path, 'utf8'), 'hello artifact');
  assert.equal(getArtifact(result.artifacts[0].id, 'someone-else'), null);
  await deleteArtifacts([result.artifacts[0].id], 'monty-test-user');
});

test('Monty artifact host function rejects path traversal and removes failed artifacts', async () => {
  const fake = fakePool(async (_code, options) => {
    await options.externalLookup.create_artifact('../private', 'not allowed', 'text/plain');
  });
  const result = await executeWithMonty({
    code: 'create_artifact("../private", "not allowed", "text/plain")',
    userId: 'monty-test-user', executionId: 'monty-invalid-artifact', getPool: async () => fake.pool
  });
  assert.equal(result.status, 'failed');
  assert.match(result.stderr, /simple filename/);
  assert.deepEqual(result.artifacts, []);
});

test('Monty provider classifies a feed timeout', async () => {
  const fake = fakePool(async () => {
    const error = new Error('feed time limit exceeded');
    error.name = 'TimeoutError';
    throw error;
  });
  const result = await executeWithMonty({ code: 'while True: pass', userId: 'monty-test-user', getPool: async () => fake.pool });
  assert.equal(result.status, 'timeout');
  assert.equal(result.exitCode, null);
});

test('Monty cancellation is owner-scoped and delivered at the next cooperative check', async () => {
  const fake = fakePool(async (_code, options) => {
    await new Promise(resolve => setTimeout(resolve, 15));
    await options.externalLookup.check_cancelled();
    return 'unreachable';
  });
  const running = executeWithMonty({
    code: 'while True: check_cancelled()', userId: 'owner-a', executionId: 'monty-cancel', getPool: async () => fake.pool
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelExecution('monty-cancel', 'owner-b'), false);
  assert.equal(cancelExecution('monty-cancel', 'owner-a'), true);
  const result = await running;
  assert.equal(result.status, 'cancelled');
  assert.match(result.stderr, /cancelled/i);
});


test('Monty provider enforces one combined stdout/stderr output budget', async () => {
  const { EXECUTION_LIMITS } = await import('../src/services/interpreter/executionSchemas.js');
  const fake = fakePool(async (_code, options) => {
    options.printCallback('stdout', 'x'.repeat(EXECUTION_LIMITS.maxOutputBytes));
    options.printCallback('stderr', 'this must not exceed the combined cap');
    return true;
  });
  const result = await executeWithMonty({ code: 'print("large")', userId: 'monty-test-user', getPool: async () => fake.pool });
  assert.equal(result.status, 'completed');
  assert.equal(Buffer.byteLength(result.stdout + result.stderr, 'utf8'), EXECUTION_LIMITS.maxOutputBytes);
});

test('Monty provider rejects a duplicate active execution ID', async () => {
  let finishFeed;
  const fake = fakePool(async () => new Promise(resolve => { finishFeed = resolve; }));
  const first = executeWithMonty({
    code: '1 + 1', userId: 'owner-a', executionId: 'same-id', getPool: async () => fake.pool
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const duplicate = await executeWithMonty({
    code: '2 + 2', userId: 'owner-b', executionId: 'same-id', getPool: async () => fake.pool
  });
  assert.equal(duplicate.status, 'failed');
  assert.match(duplicate.stderr, /already active/);
  finishFeed(2);
  assert.equal((await first).status, 'completed');
});

test('Monty artifact host function accepts keyword arguments and binary content', async () => {
  let artifactMetadata;
  const fake = fakePool(async (_code, options) => {
    artifactMetadata = await options.externalLookup.create_artifact({
      name: 'payload',
      content: new Uint8Array([0, 1, 2, 255]),
      mime_type: 'application/octet-stream'
    });
    return 'created';
  });
  const result = await executeWithMonty({
    code: "await create_artifact(name='payload', content=b'\\x00\\x01\\x02\\xff', mime_type='application/octet-stream')",
    userId: 'monty-test-user', executionId: 'monty-binary-artifact', getPool: async () => fake.pool
  });
  assert.equal(result.status, 'completed');
  assert.equal(artifactMetadata.name, 'payload.bin');
  const artifact = getArtifact(artifactMetadata.id, 'monty-test-user');
  assert.ok(artifact);
  assert.deepEqual([...await readFile(artifact.path)], [0, 1, 2, 255]);
  await deleteArtifacts([artifactMetadata.id], 'monty-test-user');
});
