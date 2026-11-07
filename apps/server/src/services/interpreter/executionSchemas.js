export const EXECUTION_LIMITS = Object.freeze({
  codeBytes: 64 * 1024,
  timeoutMs: 15_000,
  memory: '256m',
  cpus: '0.5',
  pids: 64,
  outputBytes: 128 * 1024,
  workspaceBytes: '32m',
  maxArtifacts: 8,
  maxArtifactBytes: 10 * 1024 * 1024,
  maxConcurrentPerUser: 2
});

export function validateExecutionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('A JSON object is required.'), { status: 400 });
  if (typeof input.code !== 'string' || !input.code.trim()) throw Object.assign(new Error('Python source code is required.'), { status: 400 });
  if (Buffer.byteLength(input.code, 'utf8') > EXECUTION_LIMITS.codeBytes) throw Object.assign(new Error('Python source exceeds the 64 KB limit.'), { status: 413 });
  return { code: input.code, executionId: typeof input.executionId === 'string' ? input.executionId.slice(0, 100) : undefined };
}
