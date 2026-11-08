import { EXECUTION_LIMITS } from './executionSchemas.js';
import logger from '../../utils/logger.js';

const log = logger.child({ component: 'executionQueue' });
const activeByUser = new Map();

export function acquireExecution(userId) {
  const count = activeByUser.get(userId) || 0;
  if (count >= EXECUTION_LIMITS.maxConcurrentPerUser) {
    log.warn('Concurrent execution limit reached', { userId, count });
    throw Object.assign(new Error('You have reached the concurrent Python execution limit. Wait for an existing task to finish.'), { status: 429 });
  }
  activeByUser.set(userId, count + 1);
  log.debug('Execution acquired', { userId, activeCount: count + 1 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeByUser.get(userId) || 1) - 1;
    if (next <= 0) activeByUser.delete(userId);
    else activeByUser.set(userId, next);
    log.debug('Execution released', { userId, remaining: next });
  };
}

export function getQueueStatus() {
  return { usersWithActiveExecutions: activeByUser.size, totalActiveExecutions: [...activeByUser.values()].reduce((sum, count) => sum + count, 0) };
}
