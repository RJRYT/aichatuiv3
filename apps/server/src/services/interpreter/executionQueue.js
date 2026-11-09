import { EXECUTION_LIMITS } from './executionSchemas.js';
import logger from '../../utils/logger.js';

const log = logger.child({ component: 'executionQueue' });
const activeByUser = new Map();
let activeGlobal = 0;

export function acquireExecution(userId) {
  const count = activeByUser.get(userId) || 0;
  if (count >= EXECUTION_LIMITS.maxConcurrentPerUser) {
    log.warn('Per-user concurrent execution limit reached', { userId, count });
    throw Object.assign(
      new Error(
        'You have reached the concurrent Python execution limit. Wait for an existing task to finish.'
      ),
      { status: 429 }
    );
  }
  if (activeGlobal >= EXECUTION_LIMITS.maxConcurrentGlobal) {
    log.warn('Global concurrent execution limit reached', { userId, activeGlobal });
    throw Object.assign(
      new Error('The Python execution service is busy. Please retry in a moment.'),
      { status: 429 }
    );
  }
  activeByUser.set(userId, count + 1);
  activeGlobal += 1;
  log.debug('Execution acquired', { userId, activeGlobal, userActive: count + 1 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeByUser.get(userId) || 1) - 1;
    if (next <= 0) activeByUser.delete(userId);
    else activeByUser.set(userId, next);
    activeGlobal = Math.max(0, activeGlobal - 1);
    log.debug('Execution released', { userId, activeGlobal, userActive: next });
  };
}

export function getQueueStatus() {
  return { usersWithActiveExecutions: activeByUser.size, totalActiveExecutions: activeGlobal };
}
