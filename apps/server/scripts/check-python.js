import { spawnSync } from 'node:child_process';

const bin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
if (result.error || result.status !== 0) {
  console.error(`Python runtime unavailable (${bin}). ${result.error?.message || result.stderr || ''}`);
  process.exit(1);
}
console.log(`Python runtime ready: ${(result.stdout || result.stderr).trim()} · executable=${bin}`);
console.log('Note: native subprocess execution is not an OS security sandbox.');
