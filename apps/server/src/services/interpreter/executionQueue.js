import { EXECUTION_LIMITS } from './executionSchemas.js';

const activeByUser = new Map();

export function acquireExecution(userId) {
  const count = activeByUser.get(userId) || 0;
  if (count >= EXECUTION_LIMITS.maxConcurrentPerUser) {
    throw Object.assign(new Error('You have reached the concurrent Python execution limit. Wait for an existing task to finish.'), { status: 429 });
  }
  activeByUser.set(userId, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeByUser.get(userId) || 1) - 1;
    if (next <= 0) activeByUser.delete(userId);
    else activeByUser.set(userId, next);
  };
}

export function getQueueStatus() {
  return { usersWithActiveExecutions: activeByUser.size, totalActiveExecutions: [...activeByUser.values()].reduce((sum, count) => sum + count, 0) };
}
