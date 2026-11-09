import logger from '../../utils/logger.js';

const log = logger.child({ component: 'executionSchemas' });

export const EXECUTION_LIMITS = Object.freeze({
  codeBytes: 64 * 1024,
  maxExecutionMs: 5 * 60 * 1000,
  maxOutputBytes: 128 * 1024,
  maxArtifacts: 8,
  maxArtifactBytes: 10 * 1024 * 1024,
  maxArtifactFileBytes: 10 * 1024 * 1024,
  maxConcurrentPerUser: 2,
  maxConcurrentGlobal: 8,
});

export function validateExecutionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    log.warn('Invalid execution input: not a JSON object');
    throw Object.assign(new Error('A JSON object is required.'), { status: 400 });
  }
  if (typeof input.code !== 'string' || !input.code.trim()) {
    log.warn('Invalid execution input: missing code');
    throw Object.assign(new Error('Python source code is required.'), { status: 400 });
  }
  if (Buffer.byteLength(input.code, 'utf8') > EXECUTION_LIMITS.codeBytes) {
    log.warn('Python source exceeds size limit', {
      bytes: Buffer.byteLength(input.code, 'utf8'),
      limit: EXECUTION_LIMITS.codeBytes,
    });
    throw Object.assign(new Error('Python source exceeds the 64 KB limit.'), { status: 413 });
  }
  return {
    code: input.code,
    executionId:
      typeof input.executionId === 'string' && input.executionId.trim()
        ? input.executionId.trim().slice(0, 100)
        : undefined,
    chatId:
      typeof input.chatId === 'string' && input.chatId.trim()
        ? input.chatId.trim().slice(0, 100)
        : undefined,
  };
}

function boundedInt(env, name, fallback, min, max) {
  const value = Number.parseInt(env[name] || '', 10);
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function getVercelSandboxConfig(env = process.env) {
  const token = String(env.VERCEL_TOKEN || '').trim();
  const teamId = String(env.VERCEL_TEAM_ID || '').trim();
  const projectId = String(env.VERCEL_PROJECT_ID || '').trim();
  const oidcAvailable =
    Boolean(env.VERCEL_OIDC_TOKEN) || (env.VERCEL === '1' && Boolean(env.VERCEL_ENV));
  const accessTokenAvailable = Boolean(token && teamId && projectId);
  const timeoutMs = boundedInt(
    env,
    'VERCEL_SANDBOX_TIMEOUT_MS',
    EXECUTION_LIMITS.maxExecutionMs,
    10_000,
    45 * 60 * 1000
  );
  const packageInstallTimeoutMs = boundedInt(
    env,
    'VERCEL_SANDBOX_PACKAGE_INSTALL_TIMEOUT_MS',
    180_000,
    10_000,
    10 * 60 * 1000
  );
  const requestedVcpus = boundedInt(env, 'VERCEL_SANDBOX_VCPUS', 1, 1, 4);
  const vcpus = requestedVcpus >= 4 ? 4 : requestedVcpus >= 2 ? 2 : 1;
  const requestedRegion = String(env.VERCEL_SANDBOX_REGION || '').trim();
  const image = String(env.VERCEL_SANDBOX_IMAGE || '').trim() || 'vercel/sandbox/python:3.14';
  return {
    configured: oidcAvailable || accessTokenAvailable,
    authMode: accessTokenAvailable ? 'access-token' : oidcAvailable ? 'oidc' : 'missing',
    token: accessTokenAvailable ? token : undefined,
    teamId: accessTokenAvailable ? teamId : undefined,
    projectId: accessTokenAvailable ? projectId : undefined,
    timeoutMs,
    packageInstallTimeoutMs,
    vcpus,
    region: /^[a-z]{3}\d$/.test(requestedRegion) ? requestedRegion : undefined,
    image,
    snapshotExpirationMs:
      boundedInt(env, 'VERCEL_SANDBOX_SNAPSHOT_TTL_DAYS', 7, 1, 30) * 24 * 60 * 60 * 1000,
    networkMode:
      String(env.VERCEL_SANDBOX_NETWORK_MODE || 'public').toLowerCase() === 'deny-all'
        ? 'deny-all'
        : 'public',
  };
}
