import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '../../../.env') });
dotenv.config({ path: path.resolve(scriptDir, '../../../.env.local'), override: true });

import { Sandbox } from '@vercel/sandbox';
import { getVercelSandboxConfig } from '../src/services/interpreter/executionSchemas.js';

const config = getVercelSandboxConfig();
if (!config.configured) throw new Error('Vercel Sandbox credentials are missing. Configure the VERCEL_* variables first.');
const auth = config.authMode === 'access-token' ? { token: config.token, teamId: config.teamId, projectId: config.projectId } : {};
const sandbox = await Sandbox.create({
  ...auth,
  image: config.image,
  resources: { vcpus: 1 },
  timeout: 120_000,
  persistent: false,
  ...(config.region ? { region: config.region } : {})
});
try {
  const result = await sandbox.runCommand({ cmd: 'python3', args: ['-c', 'import sys; print(sys.version.split()[0]); print(6 * 7)'], timeoutMs: 30_000 });
  const output = await result.stdout();
  if (result.exitCode !== 0 || !output.includes('42')) throw new Error(`Python smoke test failed: ${await result.stderr()}`);
  await sandbox.writeFiles([{ path: 'nemotron-smoke.txt', content: Buffer.from('Vercel Sandbox file transfer OK') }]);
  const file = await sandbox.readFileToBuffer({ path: 'nemotron-smoke.txt' });
  if (file?.toString() !== 'Vercel Sandbox file transfer OK') throw new Error('Sandbox file upload/download smoke test failed.');
  console.log('Vercel Sandbox smoke test passed.');
  console.log(output.trim());
  console.log(file.toString());
} finally {
  await sandbox.delete({ deleteOrphanSnapshots: true }).catch(() => {});
}
