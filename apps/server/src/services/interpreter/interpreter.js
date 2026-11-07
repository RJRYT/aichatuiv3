import { validateExecutionInput } from './executionSchemas.js';
import { acquireExecution } from './executionQueue.js';
import { executeInSandbox, cancelExecution } from './sandboxManager.js';

export async function executePython(input, userId, options = {}) {
  const { code, executionId } = validateExecutionInput(input);
  const release = acquireExecution(String(userId));
  try { return await executeInSandbox({ code, userId: String(userId), executionId, signal: options.signal }); }
  finally { release(); }
}
export { cancelExecution };
