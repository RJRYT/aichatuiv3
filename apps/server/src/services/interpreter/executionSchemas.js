export const EXECUTION_LIMITS = Object.freeze({
  codeBytes: 64 * 1024,
  maxFeedDurationSecs: 12,
  maxMemoryBytes: 32 * 1024 * 1024,
  maxRecursionDepth: 200,
  maxSuspensions: 256,
  maxOutputBytes: 128 * 1024,
  maxArtifacts: 8,
  maxArtifactBytes: 10 * 1024 * 1024,
  maxConcurrentPerUser: 2,
  checkoutTimeoutSeconds: 15
});

export function validateExecutionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('A JSON object is required.'), { status: 400 });
  }
  if (typeof input.code !== 'string' || !input.code.trim()) {
    throw Object.assign(new Error('Python source code is required.'), { status: 400 });
  }
  if (Buffer.byteLength(input.code, 'utf8') > EXECUTION_LIMITS.codeBytes) {
    throw Object.assign(new Error('Python source exceeds the 64 KB limit.'), { status: 413 });
  }
  return {
    code: input.code,
    executionId: typeof input.executionId === 'string' && input.executionId.trim()
      ? input.executionId.trim().slice(0, 100)
      : undefined
  };
}

export function getMontyRuntimeConfig(env = process.env) {
  const boundedInt = (name, fallback, min, max) => {
    const value = Number.parseInt(env[name] || '', 10);
    return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const maxFeedDurationSecs = boundedInt('MONTY_MAX_FEED_SECONDS', EXECUTION_LIMITS.maxFeedDurationSecs, 1, 30);
  return {
    maxProcesses: boundedInt('MONTY_MAX_WORKERS', 1, 1, 4),
    maxMemory: boundedInt('MONTY_MAX_MEMORY_BYTES', EXECUTION_LIMITS.maxMemoryBytes, 8 * 1024 * 1024, 128 * 1024 * 1024),
    maxFeedDurationSecs,
    // A one-worker managed host may have to wait for the prior feed to finish.
    checkoutTimeoutSeconds: Math.max(EXECUTION_LIMITS.checkoutTimeoutSeconds, maxFeedDurationSecs + 5)
  };
}
