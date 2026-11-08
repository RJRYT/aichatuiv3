import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { storeArtifact, guessMimeType } from './artifactStore.js';
import { listConversationUploadMetadata, getConversationUploads } from './uploadStore.js';
import { EXECUTION_LIMITS, getVercelSandboxConfig } from './executionSchemas.js';
import logger from '../../utils/logger.js';

const log = logger.child({ component: 'vercel-sandbox' });
const active = new Map();
const sandboxLocks = new Map();
let shuttingDown = false;
const WORKSPACE_NAME = 'nemotron-workspace';
const INPUT_MANIFEST_NAME = '.nemotron-inputs.json';
const FILE_INDEX_PREFIX = '__NEMOTRON_FILE_INDEX__:';
const DEPENDENCY_INDEX_PREFIX = '__NEMOTRON_DEPENDENCIES__:';
const DEFAULT_PACKAGE_INSTALL_TIMEOUT_MS = 180_000;

// Only known, commonly used Python import names are mapped to PyPI projects.
// Unknown imports are never blindly sent to PyPI (which could install a typo-squatted package).
const PYTHON_IMPORT_PACKAGES = Object.freeze({
  numpy: 'numpy', pandas: 'pandas', matplotlib: 'matplotlib', scipy: 'scipy', seaborn: 'seaborn',
  plotly: 'plotly', PIL: 'Pillow', cv2: 'opencv-python-headless', sklearn: 'scikit-learn',
  openpyxl: 'openpyxl', xlsxwriter: 'XlsxWriter', reportlab: 'reportlab', docx: 'python-docx',
  pptx: 'python-pptx', pypdf: 'pypdf', PyPDF2: 'PyPDF2', requests: 'requests', bs4: 'beautifulsoup4',
  lxml: 'lxml', yaml: 'PyYAML', sympy: 'sympy', statsmodels: 'statsmodels', sqlalchemy: 'SQLAlchemy',
  pymongo: 'pymongo', dateutil: 'python-dateutil', pytz: 'pytz', httpx: 'httpx', aiohttp: 'aiohttp',
  flask: 'Flask', fastapi: 'fastapi', pydantic: 'pydantic', rich: 'rich', tabulate: 'tabulate',
  markdown: 'Markdown', qrcode: 'qrcode[pil]', barcode: 'python-barcode', imageio: 'imageio',
  tifffile: 'tifffile', skimage: 'scikit-image', networkx: 'networkx', nltk: 'nltk', wordcloud: 'wordcloud'
});

const PYTHON_DEPENDENCY_SCANNER = String.raw`
import ast, importlib.util, json, sys
prefix = '__NEMOTRON_DEPENDENCIES__:'
script_path = sys.argv[1]
package_map = json.loads(sys.argv[2])
try:
    with open(script_path, 'r', encoding='utf-8') as source_file:
        tree = ast.parse(source_file.read(), filename=script_path)
except (OSError, SyntaxError) as error:
    print(prefix + json.dumps({'error': str(error), 'packages': [], 'unmapped': []}))
    raise SystemExit(0)
roots = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        roots.update(alias.name.split('.')[0] for alias in node.names)
    elif isinstance(node, ast.ImportFrom) and node.module:
        roots.add(node.module.split('.')[0])
missing = []
unmapped = []
for root in sorted(roots):
    if root in getattr(sys, 'stdlib_module_names', ()):
        continue
    try:
        spec = importlib.util.find_spec(root)
    except (ImportError, ValueError, ModuleNotFoundError):
        spec = None
    if spec is None:
        package = package_map.get(root)
        if package:
            missing.append(package)
        else:
            unmapped.append(root)
print(prefix + json.dumps({'packages': sorted(set(missing)), 'unmapped': unmapped}, separators=(',', ':')))
`;
const PRIVATE_SUBNETS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'
];

function sandboxNameFor(userId, chatId, executionId) {
  const identity = chatId ? `chat:${chatId}` : `execution:${executionId}`;
  const digest = createHash('sha256').update(`${userId}:${identity}`).digest('hex').slice(0, 32);
  return `nemotron-${digest}`;
}

function authOptions(config) {
  return config.authMode === 'access-token'
    ? { token: config.token, teamId: config.teamId, projectId: config.projectId }
    : {};
}

function networkPolicy(config) {
  if (config.networkMode === 'deny-all') return 'deny-all';
  // Allow public HTTPS/HTTP workloads and package installation, but block
  // private, loopback, link-local and other reserved address ranges.
  return { allow: ['*'], subnets: { deny: PRIVATE_SUBNETS } };
}

async function getSandbox({ userId, chatId, executionId, signal }) {
  const config = getVercelSandboxConfig();
  if (!config.configured) {
    throw Object.assign(new Error('Vercel Sandbox is not configured. Add VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID to the backend environment (or deploy on Vercel with OIDC enabled).'), { status: 503 });
  }
  const { Sandbox } = await import('@vercel/sandbox');
  const name = sandboxNameFor(userId, chatId, executionId);
  const options = {
    name,
    ...authOptions(config),
    image: config.image,
    resources: { vcpus: config.vcpus },
    timeout: Math.min(config.timeoutMs + (config.packageInstallTimeoutMs || DEFAULT_PACKAGE_INSTALL_TIMEOUT_MS) + 60_000, 45 * 60 * 1000),
    persistent: true,
    snapshotExpiration: config.snapshotExpirationMs,
    keepLastSnapshots: { count: 1 },
    networkPolicy: networkPolicy(config),
    resume: true,
    ...(config.region ? { region: config.region } : {})
  };
  const sandbox = await Sandbox.getOrCreate(options);
  if (signal?.aborted) { try { await sandbox.stop(); } catch {} throw Object.assign(new Error('Sandbox startup was cancelled.'), { name: 'AbortError' }); }
  try {
    await sandbox.update({
      networkPolicy: networkPolicy(config), resources: { vcpus: config.vcpus },
      timeout: Math.min(config.timeoutMs + (config.packageInstallTimeoutMs || DEFAULT_PACKAGE_INSTALL_TIMEOUT_MS) + 60_000, 45 * 60 * 1000)
    });
    if (signal?.aborted) throw Object.assign(new Error('Sandbox startup was cancelled.'), { name: 'AbortError' });
  } catch (error) {
    try { await sandbox.stop(); } catch {}
    throw error;
  }
  return { sandbox, name, config };
}

async function withSandboxLock(name, callback) {
  const previous = sandboxLocks.get(name) || Promise.resolve();
  let unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const tail = previous.then(() => gate);
  sandboxLocks.set(name, tail);
  await previous;
  try {
    return await callback();
  } finally {
    unlock();
    if (sandboxLocks.get(name) === tail) sandboxLocks.delete(name);
  }
}

function truncateOutput(value, budget) {
  const buffer = Buffer.from(String(value || ''), 'utf8');
  if (buffer.byteLength <= budget) return { text: buffer.toString('utf8'), bytes: buffer.byteLength, truncated: false };
  return { text: buffer.subarray(0, budget).toString('utf8') + '\n[output truncated by execution limit]', bytes: budget, truncated: true };
}

function safeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return normalized;
}

function safeArtifactName(relativePath) {
  const basename = path.posix.basename(relativePath);
  let clean = basename.normalize('NFKC').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 120);
  if (clean && !/^[a-zA-Z0-9]/.test(clean)) clean = `file${clean}`;
  return clean || `generated-${randomUUID().slice(0, 8)}.bin`;
}

const FILE_SCANNER = String.raw`
import hashlib, json, os, stat
manifest_path='.nemotron-artifacts.json'
try:
    with open(manifest_path,'r',encoding='utf-8') as handle:
        known=json.load(handle)
    if not isinstance(known,dict): known={}
except (OSError, ValueError, TypeError):
    known={}
items=[]
ignored={'.git','.venv','venv','node_modules','__pycache__','.cache','uploads','.ssh','.aws','.config'}
sensitive_names={'.env','id_rsa','id_ed25519','authorized_keys','known_hosts','credentials.json','service-account.json'}
total=0
skipped=0
for root, dirs, files in os.walk('.', topdown=True, followlinks=False):
    dirs[:] = [d for d in dirs if d not in ignored and not os.path.islink(os.path.join(root,d))]
    for filename in files:
        full=os.path.join(root,filename)
        try:
            info=os.lstat(full)
            if not stat.S_ISREG(info.st_mode):
                continue
            rel=os.path.relpath(full,'.').replace(os.sep,'/')
            if rel in (manifest_path,'.nemotron-inputs.json') or rel.startswith('../') or rel == '..':
                continue
            lower_name=filename.lower()
            if lower_name in sensitive_names or lower_name.startswith('.env.') or lower_name.endswith(('.pem','.key','.p12','.pfx')):
                skipped += 1
                continue
            if info.st_size <= 0:
                continue
            if info.st_size > 10485760:
                skipped += 1
                continue
            digest=hashlib.sha256()
            with open(full,'rb') as handle:
                for chunk in iter(lambda: handle.read(1024*1024),b''):
                    digest.update(chunk)
            checksum=digest.hexdigest()
            if known.get(rel) == checksum:
                continue
            if len(items) >= 8 or total + info.st_size > 10485760:
                skipped += 1
                continue
            items.append({'path':rel,'size':info.st_size,'sha256':checksum})
            total += info.st_size
        except (OSError, ValueError):
            skipped += 1
print('__NEMOTRON_FILE_INDEX__:' + json.dumps({'files':items,'known':known,'skipped':skipped}, separators=(',',':')))
`;

async function ensureSandboxDirectory(sandbox, directoryPath, signal) {
  // Vercel Sandbox mkDir is not idempotent: it returns HTTP 400 when a
  // persistent workspace already exists after a snapshot is resumed.
  // `mkdir -p` safely handles both first creation and subsequent resumes.
  const result = await sandbox.runCommand({
    cmd: 'mkdir', args: ['-p', '--', directoryPath],
    cwd: sandbox.cwd || '/', timeoutMs: 10_000, signal
  });
  if (result.exitCode !== 0) {
    const details = await readCommandOutput(result, 'stderr');
    throw new Error(`Could not ensure sandbox directory ${directoryPath}: ${details || `exit code ${result.exitCode}`}`);
  }
}

async function syncConversationUploads({ sandbox, workspacePath, userId, chatId, signal }) {
  if (!chatId) return [];
  const uploads = await listConversationUploadMetadata(userId, chatId);
  if (!uploads.length) return [];
  const manifestPath = path.posix.join(workspacePath, INPUT_MANIFEST_NAME);
  let known = {};
  try {
    const saved = await sandbox.readFileToBuffer({ path: manifestPath });
    if (saved) { const parsed = JSON.parse(saved.toString('utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) known = parsed; }
  } catch { known = {}; }
  const pendingMetadata = uploads.filter(file => !known[file.uploadId]);
  if (pendingMetadata.length) {
    const pending = await getConversationUploads(userId, chatId, pendingMetadata.map(file => file.uploadId));
    const uploadDirectory = path.posix.join(workspacePath, 'uploads');
    await ensureSandboxDirectory(sandbox, uploadDirectory, signal);
    await sandbox.writeFiles(pending.map(file => ({ path: path.posix.join(workspacePath, file.sandboxPath), content: Buffer.from(file.data), mode: 0o600 })), { signal });
    for (const file of pending) known[file.uploadId] = file.sandboxPath;
    await sandbox.writeFiles([{ path: manifestPath, content: Buffer.from(JSON.stringify(known), 'utf8'), mode: 0o600 }], { signal });
  }
  return uploads.map(file => ({ name: file.name, mimeType: file.mimeType, size: file.size, path: file.sandboxPath }));
}

async function collectWorkspaceArtifacts({ sandbox, workspacePath, userId, chatId, executionId, signal }) {
  const indexResult = await sandbox.runCommand({
    cmd: 'python3', args: ['-c', FILE_SCANNER], cwd: workspacePath,
    timeoutMs: 20_000, signal
  });
  const indexOutput = await indexResult.stdout();
  const marker = indexOutput.split(/\r?\n/).find(line => line.startsWith(FILE_INDEX_PREFIX));
  if (!marker) throw new Error('Could not enumerate files generated in the Python workspace.');
  const index = JSON.parse(marker.slice(FILE_INDEX_PREFIX.length));
  const artifacts = [];
  const warnings = [];
  const known = index.known && typeof index.known === 'object' ? index.known : {};
  let totalBytes = 0;
  for (const entry of index.files || []) {
    const relativePath = safeRelativePath(entry.path);
    const size = Number(entry.size);
    if (!relativePath || !Number.isInteger(size) || size <= 0 || size > EXECUTION_LIMITS.maxArtifactFileBytes || totalBytes + size > EXECUTION_LIMITS.maxArtifactBytes) continue;
    const sandboxBytes = await sandbox.readFileToBuffer({ path: path.posix.join(workspacePath, relativePath) });
    if (!sandboxBytes) { warnings.push(`${relativePath}: sandbox returned no file data`); continue; }
    const buffer = Buffer.isBuffer(sandboxBytes) ? sandboxBytes : Buffer.from(sandboxBytes.buffer || sandboxBytes, sandboxBytes.byteOffset || 0, sandboxBytes.byteLength);
    if (buffer.byteLength !== size) { warnings.push(`${relativePath}: expected ${size} bytes but received ${buffer.byteLength}; file was not saved`); continue; }
    const actualSha256 = createHash('sha256').update(buffer).digest('hex');
    if (entry.sha256 && actualSha256 !== entry.sha256) { warnings.push(`${relativePath}: checksum mismatch while retrieving from sandbox; file was not saved`); continue; }
    try {
      const artifact = await storeArtifact({
        ownerId: userId, chatId, executionId, name: safeArtifactName(relativePath),
        relativePath, content: buffer, mimeType: guessMimeType(relativePath)
      });
      artifacts.push(artifact);
      known[relativePath] = String(entry.sha256 || '');
      totalBytes += buffer.byteLength;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${relativePath}: ${message}`);
      log.warn('Generated file could not be added to the library', { userId, executionId, relativePath, error: message });
    }
  }
  try {
    await sandbox.writeFiles([{ path: path.posix.join(workspacePath, '.nemotron-artifacts.json'), content: Buffer.from(JSON.stringify(known), 'utf8'), mode: 0o600 }], { signal });
  } catch (error) { warnings.push(`Artifact manifest could not be updated: ${error instanceof Error ? error.message : String(error)}`); }
  return { artifacts, skipped: Number(index.skipped || 0), warnings };
}

async function readCommandOutput(command, stream) {
  try { return await command[stream](); }
  catch (error) { return `[Unable to read ${stream}: ${error instanceof Error ? error.message : String(error)}]`; }
}

async function ensurePythonEnvironment(sandbox, workspacePath, signal) {
  const pythonPath = path.posix.join(workspacePath, '.venv', 'bin', 'python');
  const checkCode = `import os,sys; sys.exit(0 if os.path.isfile(${JSON.stringify(pythonPath)}) else 1)`;
  const check = await sandbox.runCommand({ cmd: 'python3', args: ['-c', checkCode], cwd: workspacePath, timeoutMs: 5_000, signal });
  if (check.exitCode === 0) return pythonPath;
  const created = await sandbox.runCommand({ cmd: 'python3', args: ['-m', 'venv', path.posix.join(workspacePath, '.venv')], cwd: workspacePath, timeoutMs: 60_000, signal });
  if (created.exitCode !== 0) {
    const details = await readCommandOutput(created, 'stderr');
    throw new Error(`Could not initialize the conversation Python environment: ${details || `exit code ${created.exitCode}`}`);
  }
  return pythonPath;
}

async function installMissingPythonDependencies({ sandbox, pythonPath, scriptPath, workspacePath, timeoutMs, signal }) {
  const scan = await sandbox.runCommand({
    cmd: pythonPath,
    args: ['-c', PYTHON_DEPENDENCY_SCANNER, scriptPath, JSON.stringify(PYTHON_IMPORT_PACKAGES)],
    cwd: workspacePath,
    timeoutMs: 15_000,
    signal
  });
  const scanStdout = await readCommandOutput(scan, 'stdout');
  const marker = scanStdout.split(/\r?\n/).find(line => line.startsWith(DEPENDENCY_INDEX_PREFIX));
  if (scan.exitCode !== 0 || !marker) {
    const details = await readCommandOutput(scan, 'stderr');
    throw new Error(`Could not inspect Python imports before execution: ${details || scanStdout || `exit code ${scan.exitCode}`}`);
  }
  const index = JSON.parse(marker.slice(DEPENDENCY_INDEX_PREFIX.length));
  if (index.error) throw new Error(`Python source could not be checked for dependencies: ${index.error}`);
  const packages = Array.isArray(index.packages) ? index.packages.filter(value => typeof value === 'string' && /^[A-Za-z0-9_.+-]+(?:\[[A-Za-z0-9_,.-]+\])?$/.test(value)) : [];
  if (!packages.length) return { installedPackages: [], unmappedImports: Array.isArray(index.unmapped) ? index.unmapped : [] };

  log.info('Installing missing Python dependencies in conversation sandbox', { packages, workspacePath });
  const install = await sandbox.runCommand({
    cmd: pythonPath,
    args: ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--prefer-binary', ...packages],
    cwd: workspacePath,
    timeoutMs,
    signal
  });
  if (install.exitCode !== 0) {
    const details = await readCommandOutput(install, 'stderr');
    const output = await readCommandOutput(install, 'stdout');
    throw new Error(`Could not install required Python package(s) ${packages.join(', ')}: ${(details || output || `pip exited with code ${install.exitCode}`).slice(-6000)}`);
  }
  return { installedPackages: packages, unmappedImports: Array.isArray(index.unmapped) ? index.unmapped : [] };
}

export async function executeWithVercelSandbox({ code, userId, chatId = '', executionId, signal, getSandbox: getSandboxOverride = getSandbox }) {
  const id = executionId || randomUUID();
  if (shuttingDown) throw Object.assign(new Error('Python execution is unavailable while the server is shutting down.'), { status: 503 });
  const startedAt = Date.now();
  const uid = String(userId);
  const config = getVercelSandboxConfig();
  if (!config.configured) {
    throw Object.assign(new Error('Vercel Sandbox is not configured. Add VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID to the backend environment (or deploy on Vercel with OIDC enabled).'), { status: 503 });
  }
  if (signal?.aborted) return { executionId: id, status: 'cancelled', stdout: '', stderr: 'Execution cancelled before it started.', exitCode: null, durationMs: 0, artifacts: [], provider: 'vercel-sandbox' };
  const jobKey = `${uid}:${id}`;
  if (active.has(jobKey)) return { executionId: id, status: 'failed', stdout: '', stderr: 'This execution ID is already active. Use a unique executionId for each request.', exitCode: 1, durationMs: 0, artifacts: [], provider: 'vercel-sandbox' };

  const resolvedChatId = String(chatId || '');
  const sandboxName = sandboxNameFor(uid, resolvedChatId, id);
  const controller = new AbortController();
  const job = { userId: uid, sandboxName, controller, cancelled: false, command: null };
  const abortFromCaller = () => { job.cancelled = true; controller.abort(); };
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  active.set(jobKey, job);

  let sandbox;
  let workspacePath = '';
  let artifactsCollected = false;
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let status = 'failed';
  let artifacts = [];
  let inputFiles = [];
  let fileWarnings = 0;
  let installedPackages = [];
  try {
    const result = await withSandboxLock(sandboxName, async () => {
      if (job.cancelled) throw Object.assign(new Error('Execution cancelled before sandbox startup.'), { name: 'AbortError' });
      const created = await getSandboxOverride({ userId: uid, chatId: resolvedChatId, executionId: id, signal: controller.signal });
      sandbox = created.sandbox;
      if (job.cancelled || controller.signal.aborted) throw Object.assign(new Error('Execution cancelled during sandbox startup.'), { name: 'AbortError' });
      const runtimeConfig = created.config || config;
      workspacePath = path.posix.join(sandbox.cwd || '/vercel/sandbox', WORKSPACE_NAME);
      await ensureSandboxDirectory(sandbox, workspacePath, controller.signal);
      inputFiles = await syncConversationUploads({ sandbox, workspacePath, userId: uid, chatId: resolvedChatId, signal: controller.signal });
      const pythonPath = await ensurePythonEnvironment(sandbox, workspacePath, controller.signal);
      const scriptPath = `/tmp/nemotron-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}.py`;
      await sandbox.writeFiles([{ path: scriptPath, content: Buffer.from(code, 'utf8'), mode: 0o600 }], { signal: controller.signal });
      if (job.cancelled) throw Object.assign(new Error('Execution cancelled before Python started.'), { name: 'AbortError' });

      const dependencySetup = await installMissingPythonDependencies({
        sandbox, pythonPath, scriptPath, workspacePath,
        timeoutMs: runtimeConfig.packageInstallTimeoutMs || DEFAULT_PACKAGE_INSTALL_TIMEOUT_MS,
        signal: controller.signal
      });
      installedPackages = dependencySetup.installedPackages;
      if (job.cancelled) throw Object.assign(new Error('Execution cancelled during Python dependency installation.'), { name: 'AbortError' });

      log.info('Starting Python in Vercel Sandbox', { userId: uid, chatId: resolvedChatId, executionId: id, sandboxName, vcpus: runtimeConfig.vcpus, timeoutMs: runtimeConfig.timeoutMs, installedPackages });
      job.command = await sandbox.runCommand({
        cmd: pythonPath, args: ['-u', scriptPath], cwd: workspacePath,
        timeoutMs: runtimeConfig.timeoutMs, signal: controller.signal
      });
      exitCode = job.command.exitCode;
      const [rawStdout, rawStderr] = await Promise.all([readCommandOutput(job.command, 'stdout'), readCommandOutput(job.command, 'stderr')]);
      const stdoutBudget = EXECUTION_LIMITS.maxOutputBytes;
      const out = truncateOutput(rawStdout, stdoutBudget);
      const err = truncateOutput(rawStderr, Math.max(0, stdoutBudget - out.bytes));
      stdout = out.text;
      stderr = err.text;
      if (out.truncated || err.truncated) stderr += '\n[Combined output was truncated.]';
      if (job.cancelled || controller.signal.aborted) status = 'cancelled';
      else if ((exitCode === 124 || exitCode === 137) && Number(job.command.durationMs || 0) >= runtimeConfig.timeoutMs - 1500) status = 'timeout';
      else status = exitCode === 0 ? 'completed' : 'failed';

      try {
        const collected = await collectWorkspaceArtifacts({ sandbox, workspacePath, userId: uid, chatId: resolvedChatId, executionId: id });
        artifacts = collected.artifacts;
        fileWarnings = collected.skipped;
        artifactsCollected = true;
        if (collected.warnings.length) stderr += `${stderr ? '\n' : ''}File Library save warnings: ${collected.warnings.slice(0, 4).join(' | ')}`;
      } catch (error) {
        log.warn('Workspace artifact collection failed', { userId: uid, executionId: id, error: error instanceof Error ? error.message : String(error) });
        stderr += `${stderr ? '\n' : ''}Generated files could not be collected: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (fileWarnings) stderr += `${stderr ? '\n' : ''}${fileWarnings} additional file(s) were skipped because the File Library has per-execution limits.`;
      return { status };
    });
    status = result.status;
  } catch (error) {
    const cancelled = job.cancelled || controller.signal.aborted || error?.name === 'AbortError';
    const timedOut = /timed? ?out|timeout|deadline/i.test(String(error?.message || '')) || error?.code === 'COMMAND_TIMEOUT';
    status = cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed';
    stderr = String(error?.message || error || 'Vercel Sandbox execution failed.').slice(0, EXECUTION_LIMITS.maxOutputBytes);
    if (sandbox && workspacePath && !artifactsCollected && !shuttingDown) {
      try {
        const collected = await collectWorkspaceArtifacts({ sandbox, workspacePath, userId: uid, chatId: resolvedChatId, executionId: id });
        artifacts = collected.artifacts;
        fileWarnings = collected.skipped;
        artifactsCollected = true;
        if (collected.warnings.length) stderr += `${stderr ? '\n' : ''}File Library save warnings: ${collected.warnings.slice(0, 4).join(' | ')}`;
        if (artifacts.length) stderr += `\nCollected ${artifacts.length} file(s) generated before the execution stopped.`;
      } catch (collectionError) {
        log.warn('Partial artifact collection after execution interruption failed', { userId: uid, executionId: id, error: collectionError instanceof Error ? collectionError.message : String(collectionError) });
      }
    }
    log.warn('Vercel Sandbox execution failed', { userId: uid, executionId: id, status, error: stderr });
  } finally {
    if (sandbox) {
      try {
        // Stop (do not delete) so Vercel snapshots the conversation workspace.
        // The next tool call resumes it, while the VM is not left running idle.
        await sandbox.stop();
      } catch (error) {
        log.warn('Vercel Sandbox stop/snapshot failed', { userId: uid, executionId: id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    signal?.removeEventListener('abort', abortFromCaller);
    active.delete(jobKey);
  }

  log.info('Python execution finished', { userId: uid, chatId: resolvedChatId, executionId: id, status, durationMs: Date.now() - startedAt, artifactCount: artifacts.length, exitCode });
  return {
    executionId: id, status, stdout, stderr, exitCode: status === 'completed' ? 0 : status === 'failed' ? (exitCode ?? 1) : null,
    durationMs: Date.now() - startedAt, artifacts, inputFiles, installedPackages, provider: 'vercel-sandbox',
    sandbox: { name: sandboxName, persistentWorkspace: Boolean(resolvedChatId), python: 'Python 3.14 (Vercel managed Python image)' }
  };
}

export function executeInSandbox(args) {
  return executeWithVercelSandbox(args);
}

export function cancelExecution(executionId, userId) {
  const item = active.get(`${String(userId)}:${executionId}`);
  if (!item || item.userId !== String(userId)) return false;
  item.cancelled = true;
  item.controller.abort();
  return true;
}

export async function deleteSandboxForChat(userId, chatId) {
  const config = getVercelSandboxConfig();
  if (!config.configured || !chatId) return false;
  const name = sandboxNameFor(String(userId), String(chatId), '');
  for (const job of active.values()) if (job.sandboxName === name) { job.cancelled = true; job.controller.abort(); }
  try {
    return await withSandboxLock(name, async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = await Sandbox.get({ name, ...authOptions(config) });
      await sandbox.delete({ deleteOrphanSnapshots: true });
      log.info('Conversation sandbox deleted', { userId: String(userId), chatId: String(chatId), sandboxName: name });
      return true;
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/not found|404|does not exist/i.test(message)) return false;
    log.warn('Conversation sandbox cleanup failed', { userId: String(userId), chatId: String(chatId), error: message });
    return false;
  }
}

export function getInterpreterStatus() {
  const config = getVercelSandboxConfig();
  return {
    provider: 'vercel-sandbox', runtime: 'Vercel Firecracker microVM · CPython 3.14',
    configured: config.configured, authMode: config.authMode, ready: config.configured,
    activeExecutions: active.size, vcpus: config.vcpus, timeoutMs: config.timeoutMs,
    networkMode: config.networkMode, persistentWorkspace: true
  };
}

export async function closeSandboxManager() {
  shuttingDown = true;
  for (const job of active.values()) {
    job.cancelled = true;
    job.controller.abort();
  }
}

export { sandboxNameFor as getSandboxNameForContext };
