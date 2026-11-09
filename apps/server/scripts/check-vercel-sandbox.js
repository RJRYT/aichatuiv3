import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '../../../.env') });
dotenv.config({ path: path.resolve(scriptDir, '../../../.env.local'), override: true });

import { getVercelSandboxConfig } from '../src/services/interpreter/executionSchemas.js';

const config = getVercelSandboxConfig();
console.log('Vercel Sandbox configuration');
console.log(`  Configured: ${config.configured ? 'yes' : 'no'}`);
console.log(`  Authentication: ${config.authMode}`);
console.log(`  Image: ${config.image}`);
console.log(`  vCPUs: ${config.vcpus}`);
console.log(`  Session timeout: ${Math.round(config.timeoutMs / 1000)} seconds`);
console.log(`  Network mode: ${config.networkMode}`);
if (!config.configured) {
  console.error(
    '\nSet VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID for external hosting. On Vercel, enable project OIDC instead.'
  );
  process.exitCode = 1;
} else {
  try {
    await import('@vercel/sandbox');
    console.log(
      '\nSDK import: OK. Run `npm run sandbox:smoke` to create a real sandbox and execute Python.'
    );
  } catch (error) {
    console.error(`\nSDK import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
