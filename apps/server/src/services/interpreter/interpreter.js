import { validateExecutionInput } from './executionSchemas.js';
import { acquireExecution } from './executionQueue.js';
import { executeInSandbox, cancelExecution } from './sandboxManager.js';
import logger from '../../utils/logger.js';

const log = logger.child({ component: 'interpreter' });

export async function executePython(input, userId, options = {}) {
  const { code, executionId, chatId } = validateExecutionInput(input);
  const uid = String(userId);
  log.debug('Python execution requested', {
    userId: uid,
    executionId,
    chatId,
    codeBytes: Buffer.byteLength(code, 'utf8'),
  });
  const release = acquireExecution(uid);
  try {
    return await executeInSandbox({
      code,
      userId: uid,
      executionId,
      chatId: options.chatId || chatId,
      signal: options.signal,
    });
  } finally {
    release();
  }
}

export { cancelExecution };
