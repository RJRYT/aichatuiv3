import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectArtifacts } from './artifactStore.js';
import { EXECUTION_LIMITS } from './executionSchemas.js';

const active = new Map();
const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const allowUnsandboxed = process.env.PYTHON_ALLOW_UNSANDBOXED === 'true';
const maxOutput = EXECUTION_LIMITS.outputBytes;

function appendLimited(current, chunk) {
  if (current.length >= maxOutput) return current;
  return (current + chunk.toString('utf8')).slice(0, maxOutput);
}

function terminate(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
  const force = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 500);
  force.unref?.();
}

/**
 * Native Python provider for hosts where Docker/root access is unavailable.
 *
 * IMPORTANT: A subprocess is NOT a security sandbox. It runs with the Node
 * process account's OS permissions. Enable only for trusted/private use unless
 * the hosting provider separately isolates processes at the OS/container level.
 */
export async function executeInSandbox({ code, userId, executionId, signal }) {
  const id = executionId || randomUUID();
  const startedAt = Date.now();
  if (!allowUnsandboxed) {
    return {
      executionId: id, status: 'failed', stdout: '',
      stderr: 'Native Python execution is disabled. Set PYTHON_ALLOW_UNSANDBOXED=true only if you trust submitted code, or configure an isolated remote executor.',
      exitCode: null, durationMs: Date.now() - startedAt, artifacts: []
    };
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nemotron-python-'));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  active.set(id, { controller, userId: String(userId), child: null });
  let stdout = '', stderr = '', exitCode = null, timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, EXECUTION_LIMITS.timeoutMs);
  try {
    // Keep the process environment minimal; this is hygiene, not a security boundary.
    const env = {
      PATH: process.env.PYTHON_PATH || process.env.PATH || '',
      HOME: workspace,
      TMPDIR: workspace,
      TMP: workspace,
      TEMP: workspace,
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      MPLCONFIGDIR: path.join(workspace, '.mpl')
    };
    const child = spawn(pythonBin, ['-I', '-u', '-c', code], {
      cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    active.get(id).child = child;
    child.stdout.on('data', chunk => { stdout = appendLimited(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendLimited(stderr, chunk); });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (codeValue, sig) => resolve({ code: codeValue, signal: sig }));
      controller.signal.addEventListener('abort', () => terminate(child), { once: true });
    });
    exitCode = exit.code;
    if (exit.signal && !controller.signal.aborted) stderr = appendLimited(stderr, `\nProcess terminated (${exit.signal}).`);
    const status = timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : exitCode === 0 ? 'completed' : 'failed';
    const artifacts = status === 'completed' ? await collectArtifacts(workspace, userId).catch(error => {
      stderr = appendLimited(stderr, `\nArtifact collection failed: ${error.message}`);
      return [];
    }) : [];
    return { executionId: id, status, stdout, stderr, exitCode, durationMs: Date.now() - startedAt, artifacts };
  } catch (error) {
    return {
      executionId: id,
      status: timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'failed',
      stdout, stderr: appendLimited(stderr, error.message), exitCode,
      durationMs: Date.now() - startedAt, artifacts: []
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    active.delete(id);
    // Artifact files are copied/registered from this workspace. Keep it until expiry
    // when artifacts exist; otherwise remove it immediately.
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

export function cancelExecution(executionId, userId) {
  const item = active.get(executionId);
  if (!item || item.userId !== String(userId)) return false;
  item.controller.abort();
  return true;
}
