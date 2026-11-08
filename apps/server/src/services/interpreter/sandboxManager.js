import { randomUUID } from 'node:crypto';
import { storeArtifact, deleteArtifacts } from './artifactStore.js';
import { EXECUTION_LIMITS, getMontyRuntimeConfig } from './executionSchemas.js';

const active = new Map();
let poolPromise;
let poolReady = false;

function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { Monty } = await import('@pydantic/monty/wasm');
      const config = getMontyRuntimeConfig();
      const pool = await Monty.create({
        minProcesses: 0,
        maxProcesses: config.maxProcesses,
        checkoutTimeout: config.checkoutTimeoutSeconds
      });
      poolReady = true;
      return pool;
    })().catch(error => {
      poolReady = false;
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

function normalizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 8000 ? `${value.slice(0, 8000)}… [truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return Number.isFinite(value) || typeof value === 'boolean' ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: 'bytes', byteLength: value.byteLength, note: 'Binary values are not inlined; use create_artifact() to create a downloadable file.' };
  }
  if (depth >= 6) return '[maximum result depth reached]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular reference]';
  seen.add(value);
  let output;
  if (Array.isArray(value)) output = value.slice(0, 100).map(item => normalizeValue(item, depth + 1, seen));
  else if (value instanceof Map) {
    const entries = [...value.entries()].slice(0, 100);
    output = Object.fromEntries(entries.map(([key, item], index) => [typeof key === 'string' ? key : String(index), normalizeValue(item, depth + 1, seen)]));
  } else if (value instanceof Set) output = [...value].slice(0, 100).map(item => normalizeValue(item, depth + 1, seen));
  else {
    output = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      output[key] = normalizeValue(item, depth + 1, seen);
    }
  }
  seen.delete(value);
  return output;
}

function getExceptionType(error) {
  return String(error?.exception?.typeName || error?.name || 'Error');
}

function formatError(error) {
  if (typeof error?.display === 'function') {
    try { return String(error.display('traceback')); } catch {
      try { return String(error.display()); } catch { /* fall through */ }
    }
  }
  return String(error?.message || error || 'Python execution failed.');
}

function makeArtifactWriter({ ownerId, job }) {
  const created = [];
  let totalBytes = 0;
  const createArtifact = async (...callArgs) => {
    if (job.cancelled) throw Object.assign(new Error('Execution cancelled by the user.'), { name: 'RuntimeError' });
    let [name, content, mimeType = 'text/plain'] = callArgs;
    const maybeKwargs = callArgs.at(-1);
    if (maybeKwargs && typeof maybeKwargs === 'object' && !Buffer.isBuffer(maybeKwargs) && !(maybeKwargs instanceof Uint8Array) && !Array.isArray(maybeKwargs)) {
      name = maybeKwargs.name ?? name;
      content = maybeKwargs.content ?? content;
      mimeType = maybeKwargs.mime_type ?? maybeKwargs.mimeType ?? mimeType;
    }
    if (created.length >= EXECUTION_LIMITS.maxArtifacts) throw new Error(`An execution may create at most ${EXECUTION_LIMITS.maxArtifacts} artifacts.`);
    const contentBytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content?.byteLength;
    if (!Number.isFinite(contentBytes)) throw new Error('Artifact content must be a string or bytes value.');
    if (totalBytes + contentBytes > EXECUTION_LIMITS.maxArtifactBytes) throw new Error('The total artifact size for this execution exceeds 10 MB.');
    const artifact = await storeArtifact({ ownerId, name, content, mimeType: String(mimeType || 'text/plain') });
    created.push(artifact);
    totalBytes += artifact.size;
    return { id: artifact.id, name: artifact.name, size: artifact.size, mime_type: artifact.mimeType, download_url: artifact.downloadUrl };
  };
  return { createArtifact, created };
}

/**
 * Executes code with Pydantic Monty's WebAssembly worker pool.
 * The sandbox has no ambient filesystem, network or environment access. The
 * only host capabilities exposed here are bounded artifact creation and a
 * cooperative cancellation check.
 */
export async function executeWithMonty({ code, userId, executionId, signal, getPool: getPoolOverride = getPool }) {
  const id = executionId || randomUUID();
  const startedAt = Date.now();
  const job = { userId: String(userId), cancelled: Boolean(signal?.aborted) };
  if (job.cancelled) {
    return { executionId: id, status: 'cancelled', stdout: '', stderr: 'Execution cancelled before it started.', exitCode: null, durationMs: 0, artifacts: [], provider: 'pydantic-monty-wasm' };
  }
  if (active.has(id)) {
    return { executionId: id, status: 'failed', stdout: '', stderr: 'This execution ID is already active. Use a unique executionId for each request.', exitCode: 1, durationMs: 0, artifacts: [], provider: 'pydantic-monty-wasm' };
  }
  active.set(id, job);
  const onAbort = () => { job.cancelled = true; };
  signal?.addEventListener('abort', onAbort, { once: true });

  let session;
  let stdout = '';
  let stderr = '';
  let outputBytes = 0;
  let result;
  const appendOutput = (stream, incoming) => {
    const available = EXECUTION_LIMITS.maxOutputBytes - outputBytes;
    if (available <= 0) return;
    const bytes = Buffer.from(String(incoming ?? ''), 'utf8');
    const accepted = bytes.subarray(0, available).toString('utf8');
    outputBytes += Buffer.byteLength(accepted, 'utf8');
    if (stream === 'stderr') stderr += accepted;
    else stdout += accepted;
  };
  const { createArtifact, created } = makeArtifactWriter({ ownerId: userId, job });
  const config = getMontyRuntimeConfig();

  try {
    const pool = await getPoolOverride();
    if (job.cancelled) throw Object.assign(new Error('Execution cancelled by the user.'), { name: 'ExecutionCancelledError' });
    session = await pool.checkout({
      scriptName: 'nemotron_agent.py',
      printFlushInterval: 0.005,
      limits: {
        maxMemory: config.maxMemory,
        maxFeedDurationSecs: config.maxFeedDurationSecs,
        maxRecursionDepth: EXECUTION_LIMITS.maxRecursionDepth,
        maxSuspensions: EXECUTION_LIMITS.maxSuspensions,
        maxTotalSleepSecs: 1
      }
    });
    if (job.cancelled) throw Object.assign(new Error('Execution cancelled before Python started.'), { name: 'ExecutionCancelledError' });

    result = await session.feedRun(code, {
      externalLookup: {
        create_artifact: createArtifact,
        check_cancelled: () => {
          if (job.cancelled) throw Object.assign(new Error('Execution cancelled by the user.'), { name: 'RuntimeError' });
          return true;
        }
      },
      printCallback: appendOutput
    });

    if (job.cancelled) {
      await deleteArtifacts(created.map(item => item.id), userId);
      return {
        executionId: id, status: 'cancelled', stdout, stderr,
        exitCode: null, durationMs: Date.now() - startedAt, artifacts: [], provider: 'pydantic-monty-wasm'
      };
    }

    return {
      executionId: id,
      status: 'completed',
      stdout,
      stderr,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      result: normalizeValue(result),
      artifacts: created,
      provider: 'pydantic-monty-wasm'
    };
  } catch (error) {
    const exceptionType = getExceptionType(error);
    const timedOut = exceptionType === 'TimeoutError' || Boolean(error?.timedOut) || /feed time limit exceeded|timed out/i.test(String(error?.message || ''));
    const cancelled = job.cancelled || exceptionType === 'ExecutionCancelledError';
    if (created.length) await deleteArtifacts(created.map(item => item.id), userId);
    const status = cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed';
    const detail = formatError(error);
    appendOutput('stderr', stderr ? `\n${detail}` : detail);
    return {
      executionId: id,
      status,
      stdout,
      stderr,
      exitCode: status === 'failed' ? 1 : null,
      durationMs: Date.now() - startedAt,
      artifacts: [],
      provider: 'pydantic-monty-wasm'
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    active.delete(id);
    if (session) {
      try { await session.close(); }
      catch (error) { console.warn('[monty] session cleanup failed:', error?.message || error); }
    }
  }
}

export function executeInSandbox(args) {
  return executeWithMonty(args);
}

export function cancelExecution(executionId, userId) {
  const item = active.get(executionId);
  if (!item || item.userId !== String(userId)) return false;
  item.cancelled = true;
  return true;
}

export async function closeMontyPool() {
  if (!poolPromise) return;
  const current = poolPromise;
  poolPromise = undefined;
  poolReady = false;
  try {
    const pool = await current;
    await pool.close();
  } catch (error) {
    console.warn('[monty] pool shutdown failed:', error?.message || error);
  } finally {
    poolReady = false;
  }
}

export function getInterpreterStatus() {
  return { provider: 'pydantic-monty-wasm', runtime: 'WebAssembly + Node.js worker_threads', ready: poolReady, initializing: Boolean(poolPromise) && !poolReady, activeExecutions: active.size };
}

export { normalizeValue as normalizeMontyValue, getExceptionType as getMontyExceptionType };
