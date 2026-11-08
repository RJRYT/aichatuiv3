import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { executeWithVercelSandbox, cancelExecution, getSandboxNameForContext } from '../src/services/interpreter/sandboxManager.js';
import { getArtifact, listArtifacts, deleteArtifact } from '../src/services/interpreter/artifactStore.js';
import { storeConversationUploads, deleteConversationUploads } from '../src/services/interpreter/uploadStore.js';

const originalEnv = {};
function configureVercel() {
  for (const key of ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) originalEnv[key] = process.env[key];
  process.env.VERCEL_TOKEN = 'test-token';
  process.env.VERCEL_TEAM_ID = 'test-team';
  process.env.VERCEL_PROJECT_ID = 'test-project';
}
function restoreVercel() {
  for (const key of ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
}
function fakeSandbox({ python = { exitCode: 0, stdout: '42\n', stderr: '' }, files = [], dependencies = [] } = {}) {
  let stopped = 0;
  const installRequests = [];
  const sandbox = {
    cwd: '/vercel/sandbox',
    async mkDir() {},
    async writeFiles() {},
    async runCommand(params) {
      if (params.args?.[0] === '-m' && params.args?.[1] === 'pip') { installRequests.push(params.args.slice(2)); return { exitCode: 0, async stdout() { return 'Successfully installed'; }, async stderr() { return ''; } }; }
      if (params.args?.[0] === '-c' && String(params.args?.[1] || '').includes('ast.parse')) return { exitCode: 0, async stdout() { return '__NEMOTRON_DEPENDENCIES__:' + JSON.stringify({ packages: dependencies, unmapped: [] }); }, async stderr() { return ''; } };
      if (params.args?.[0] === '-u') return {
        exitCode: python.exitCode,
        async stdout() { return python.stdout; },
        async stderr() { return python.stderr; }
      };
      return {
        exitCode: 0,
        async stdout() { return '__NEMOTRON_FILE_INDEX__:' + JSON.stringify({ files: files.map(file => ({ path: file.path, size: Buffer.byteLength(file.content), sha256: createHash('sha256').update(file.content).digest('hex') })), known: {}, skipped: 0 }); },
        async stderr() { return ''; }
      };
    },
    async readFileToBuffer({ path }) {
      const relative = path.replace('/vercel/sandbox/nemotron-workspace/', '');
      const file = files.find(item => item.path === relative);
      return file ? Buffer.from(file.content) : null;
    },
    async stop() { stopped += 1; }
  };
  return { sandbox, stopped: () => stopped, installRequests };
}


test('conversation sandbox names are deterministic but isolated by owner and chat', () => {
  const first = getSandboxNameForContext('owner-a', 'chat-a', 'ignored');
  assert.equal(first, getSandboxNameForContext('owner-a', 'chat-a', 'another-execution'));
  assert.notEqual(first, getSandboxNameForContext('owner-b', 'chat-a', 'ignored'));
  assert.notEqual(first, getSandboxNameForContext('owner-a', 'chat-b', 'ignored'));
});

test('persistent conversation workspace directory creation is idempotent across sandbox resumes', async () => {
  configureVercel();
  try {
    let workspaceExists = false;
    let mkdirCalls = 0;
    const fake = {
      cwd: '/vercel',
      async mkDir() { throw new Error('non-idempotent SDK mkDir must not be used'); },
      async writeFiles() {},
      async readFileToBuffer() { return null; },
      async stop() {},
      async runCommand(params) {
        if (params.cmd === 'mkdir') {
          assert.deepEqual(params.args.slice(0, 2), ['-p', '--']);
          mkdirCalls += 1;
          // Simulate mkdir -p: existing directories are a successful no-op.
          workspaceExists = true;
          return { exitCode: 0, async stdout() { return ''; }, async stderr() { return ''; } };
        }
        if (params.args?.[0] === '-c' && String(params.args?.[1] || '').includes('ast.parse')) return { exitCode: 0, async stdout() { return '__NEMOTRON_DEPENDENCIES__:{"packages":[],"unmapped":[]}'; }, async stderr() { return ''; } };
        if (params.args?.[0] === '-u') {
          return { exitCode: 0, async stdout() { return 'ok\n'; }, async stderr() { return ''; } };
        }
        if (params.args?.[0] === '-c' && String(params.args[1]).includes('os.path.isfile')) {
          return { exitCode: workspaceExists ? 0 : 1, async stdout() { return ''; }, async stderr() { return ''; } };
        }
        return { exitCode: 0, async stdout() { return '__NEMOTRON_FILE_INDEX__:{"files":[],"known":{},"skipped":0}'; }, async stderr() { return ''; } };
      }
    };
    const getSandbox = async () => ({ sandbox: fake, config: { timeoutMs: 300000, vcpus: 1 } });
    const first = await executeWithVercelSandbox({ code: 'print("ok")', userId: 'mkdir-owner', chatId: 'mkdir-chat', executionId: 'mkdir-first', getSandbox });
    const second = await executeWithVercelSandbox({ code: 'print("ok")', userId: 'mkdir-owner', chatId: 'mkdir-chat', executionId: 'mkdir-second', getSandbox });
    assert.equal(first.status, 'completed');
    assert.equal(second.status, 'completed');
    assert.equal(mkdirCalls, 2);
  } finally { restoreVercel(); }
});

test('Vercel provider captures Python output and persists generated files in the owner library', async () => {
  configureVercel();
  try {
    const fake = fakeSandbox({ files: [{ path: 'reports/summary.csv', content: 'name,value\nalpha,42\n' }] });
    const result = await executeWithVercelSandbox({
      code: 'print(42)', userId: 'vercel-test-user', chatId: 'chat-a', executionId: 'vercel-success',
      getSandbox: async () => ({ sandbox: fake.sandbox, config: { timeoutMs: 300000, vcpus: 1 } })
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.stdout, '42\n');
    assert.equal(result.provider, 'vercel-sandbox');
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].name, 'summary.csv');
    assert.equal(result.artifacts[0].mimeType, 'text/csv');
    assert.match(result.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    const artifact = await getArtifact(result.artifacts[0].id, 'vercel-test-user');
    assert.equal(artifact.data.toString(), 'name,value\nalpha,42\n');
    assert.equal(artifact.data.byteLength, result.artifacts[0].size);
    assert.equal(await getArtifact(result.artifacts[0].id, 'other-user'), null);
    const library = await listArtifacts('vercel-test-user');
    assert.equal(library.total, 1);
    assert.equal(library.totalBytes, Buffer.byteLength('name,value\nalpha,42\n'));
    assert.equal((await listArtifacts('other-user')).total, 0);
    assert.equal(fake.stopped(), 1);
    await deleteArtifact(result.artifacts[0].id, 'vercel-test-user');
  } finally { restoreVercel(); }
});


test('common missing Python imports are installed automatically and persisted in the conversation sandbox', async () => {
  configureVercel();
  try {
    const fake = fakeSandbox({ dependencies: ['matplotlib', 'numpy'] });
    const result = await executeWithVercelSandbox({
      code: 'import matplotlib.pyplot as plt\nimport numpy as np\nprint(np.__version__)',
      userId: 'dependency-test-user', chatId: 'dependency-chat', executionId: 'dependency-install',
      getSandbox: async () => ({ sandbox: fake.sandbox, config: { timeoutMs: 300000, vcpus: 1 } })
    });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.installedPackages, ['matplotlib', 'numpy']);
    assert.equal(fake.installRequests.length, 1);
    assert.deepEqual(fake.installRequests[0].slice(-2), ['matplotlib', 'numpy']);
  } finally { restoreVercel(); }
});

test('conversation uploads are byte-verified and stale zero-byte sandbox copies are repaired', async () => {
  configureVercel();
  const owner = 'vercel-upload-owner';
  const chatId = 'vercel-upload-chat';
  try {
    const csv = Buffer.from('name,value\nalpha,42\n');
    await storeConversationUploads(owner, chatId, [{ name: 'input.csv', dataUrl: `data:text/csv;base64,${csv.toString('base64')}` }]);
    const written = [];
    const fake = {
      cwd: '/vercel/sandbox', async mkDir() {}, async writeFiles(files) { written.push(...files); }, async stop() {},
      async readFileToBuffer({ path }) {
        const saved = written.find(file => file.path === path);
        if (saved) return Buffer.from(saved.content);
        // Simulate a stale snapshot containing a zero-byte copy of the upload.
        if (path.includes('/uploads/')) return Buffer.alloc(0);
        return null;
      },
      async runCommand(params) {
        if (params.args?.[0] === '-u') return { exitCode: 0, async stdout() { return 'input mounted\n'; }, async stderr() { return ''; } };
        if (params.args?.[0] === '-c') {
          if (String(params.args[1]).includes('ast.parse')) return { exitCode: 0, async stdout() { return '__NEMOTRON_DEPENDENCIES__:{"packages":[],"unmapped":[]}'; }, async stderr() { return ''; } };
          if (String(params.args[1]).includes('sys.exit')) return { exitCode: 0, async stdout() { return ''; }, async stderr() { return ''; } };
          return { exitCode: 0, async stdout() { return '__NEMOTRON_FILE_INDEX__:{"files":[],"known":{},"skipped":0}'; }, async stderr() { return ''; } };
        }
        return { exitCode: 0, async stdout() { return ''; }, async stderr() { return ''; } };
      }
    };
    const result = await executeWithVercelSandbox({ code: 'print("input mounted")', userId: owner, chatId, executionId: 'vercel-upload-test', getSandbox: async () => ({ sandbox: fake, config: { timeoutMs: 300000, vcpus: 1 } }) });
    assert.equal(result.status, 'completed');
    assert.equal(result.inputFiles.length, 1);
    assert.match(result.inputFiles[0].path, /^uploads\/[a-f0-9-]{36}_input\.csv$/i);
    const mounted = written.find(file => file.path.endsWith(result.inputFiles[0].path));
    assert.ok(mounted);
    assert.deepEqual(Buffer.from(mounted.content), csv);
    assert.equal(result.inputFiles[0].size, csv.byteLength);
    assert.equal(result.inputFiles[0].sha256, createHash('sha256').update(csv).digest('hex'));
  } finally {
    await deleteConversationUploads(owner, chatId);
    restoreVercel();
  }
});

test('Vercel provider classifies non-zero Python exit codes as failed', async () => {
  configureVercel();
  try {
    const fake = fakeSandbox({ python: { exitCode: 1, stdout: '', stderr: 'ValueError: bad input' } });
    const result = await executeWithVercelSandbox({
      code: 'raise ValueError("bad input")', userId: 'vercel-test-user', executionId: 'vercel-fail',
      getSandbox: async () => ({ sandbox: fake.sandbox, config: { timeoutMs: 300000, vcpus: 1 } })
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ValueError/);
  } finally { restoreVercel(); }
});

test('Vercel cancellation is owner-scoped and aborts the active command', async () => {
  configureVercel();
  try {
    let started;
    const fake = {
      cwd: '/vercel/sandbox', async mkDir() {}, async writeFiles() {}, async stop() {},
      async runCommand(params) {
        if (params.args?.[0] === '-c' && String(params.args?.[1] || '').includes('ast.parse')) return { exitCode: 0, async stdout() { return '__NEMOTRON_DEPENDENCIES__:{"packages":[],"unmapped":[]}'; }, async stderr() { return ''; } };
        if (params.args?.[0] !== '-u') return { exitCode: 0, async stdout() { return '__NEMOTRON_FILE_INDEX__:{"files":[],"skipped":0}'; }, async stderr() { return ''; } };
        started = true;
        return new Promise((resolve, reject) => params.signal.addEventListener('abort', () => reject(Object.assign(new Error('Command aborted'), { name: 'AbortError' })), { once: true }));
      }
    };
    const running = executeWithVercelSandbox({ code: 'while True: pass', userId: 'owner-a', executionId: 'vercel-cancel', getSandbox: async () => ({ sandbox: fake, config: { timeoutMs: 300000, vcpus: 1 } }) });
    while (!started) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(cancelExecution('vercel-cancel', 'owner-b'), false);
    assert.equal(cancelExecution('vercel-cancel', 'owner-a'), true);
    assert.equal((await running).status, 'cancelled');
  } finally { restoreVercel(); }
});

test('Vercel provider rejects duplicate active execution IDs', async () => {
  configureVercel();
  try {
    let started;
    let finish;
    const fake = {
      cwd: '/vercel/sandbox', async mkDir() {}, async writeFiles() {}, async stop() {},
      async runCommand(params) {
        if (params.args?.[0] === '-c' && String(params.args?.[1] || '').includes('ast.parse')) return { exitCode: 0, async stdout() { return '__NEMOTRON_DEPENDENCIES__:{"packages":[],"unmapped":[]}'; }, async stderr() { return ''; } };
        if (params.args?.[0] !== '-u') return { exitCode: 0, async stdout() { return '__NEMOTRON_FILE_INDEX__:{"files":[],"skipped":0}'; }, async stderr() { return ''; } };
        started = true;
        return new Promise(resolve => { finish = resolve; });
      }
    };
    const first = executeWithVercelSandbox({ code: '1+1', userId: 'owner-a', executionId: 'duplicate-id', getSandbox: async () => ({ sandbox: fake, config: { timeoutMs: 300000, vcpus: 1 } }) });
    while (!started) await new Promise(resolve => setTimeout(resolve, 1));
    const duplicate = await executeWithVercelSandbox({ code: '2+2', userId: 'owner-a', executionId: 'duplicate-id', getSandbox: async () => ({ sandbox: fake, config: { timeoutMs: 300000, vcpus: 1 } }) });
    assert.equal(duplicate.status, 'failed');
    assert.match(duplicate.stderr, /already active/);
    finish({ exitCode: 0, async stdout() { return ''; }, async stderr() { return ''; } });
    assert.equal((await first).status, 'completed');
  } finally { restoreVercel(); }
});

test('MongoDB BSON Binary artifact data is normalized using its logical byte length', async () => {
  const { normalizeStoredBinary } = await import('../src/services/interpreter/artifactStore.js');
  const expected = Buffer.from([0, 1, 2, 3, 254, 255]);
  const backing = Buffer.alloc(32, 99);
  expected.copy(backing);
  const bsonBinary = { _bsontype: 'Binary', buffer: backing, position: expected.length };
  const actual = normalizeStoredBinary(bsonBinary);
  assert.ok(Buffer.isBuffer(actual));
  assert.deepEqual(actual, expected);
  assert.equal(actual.byteLength, expected.byteLength);
});

test('artifact binary normalization supports typed-array views without copying unrelated backing bytes', async () => {
  const { normalizeStoredBinary } = await import('../src/services/interpreter/artifactStore.js');
  const backing = new Uint8Array([90, 91, 10, 11, 12, 92]);
  const view = backing.subarray(2, 5);
  assert.deepEqual(normalizeStoredBinary(view), Buffer.from([10, 11, 12]));
});
