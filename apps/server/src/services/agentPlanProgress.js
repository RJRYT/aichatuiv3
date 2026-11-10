function emitPlanTask(agentState, task, status, note, emitAgentEvent) {
  if (!task || !agentState.plan) return;
  task.status = status;
  task.note = String(note || '').slice(0, 500);
  task.updatedAt = new Date().toISOString();
  emitAgentEvent('task_updated', { task: { ...task }, plan: agentState.plan });
}

export function startNextPlanTask(agentState, emitAgentEvent, note = 'Work is in progress.') {
  const tasks = agentState.plan?.tasks || [];
  if (tasks.some((task) => task.status === 'running')) return tasks.find((task) => task.status === 'running');
  const next = tasks.find((task) => task.status === 'pending' &&
    (task.dependsOn || []).every((id) => tasks.find((candidate) => candidate.id === id)?.status === 'completed'));
  if (!next) return null;
  emitPlanTask(agentState, next, 'running', note, emitAgentEvent);
  return next;
}

export function initializePlanProgress(agentState, emitAgentEvent) {
  const tasks = agentState.plan?.tasks || [];
  const firstTask = tasks[0];
  const planningTask = firstTask && /plan|requirement|scope|design|architecture|specification/i.test(`${firstTask.title} ${firstTask.description}`)
    ? firstTask
    : null;
  if (planningTask?.status === 'pending') {
    emitPlanTask(agentState, planningTask, 'completed', 'Requirements and execution plan have been established.', emitAgentEvent);
  }
  startNextPlanTask(agentState, emitAgentEvent, 'Ready to implement this part of the deliverable.');
}

export function advancePlanAfterExecution(agentState, emitAgentEvent, verified) {
  const tasks = agentState.plan?.tasks || [];
  if (!tasks.length) return;
  if (verified) {
    for (const task of tasks) {
      if (!['completed', 'skipped'].includes(task.status)) {
        emitPlanTask(agentState, task, 'completed', 'The generated deliverable passed backend artifact verification.', emitAgentEvent);
      }
    }
    return;
  }
  const running = tasks.find((task) => task.status === 'running');
  if (running) {
    emitPlanTask(agentState, running, 'completed', 'This execution pass completed; remaining validation or packaging work is continuing.', emitAgentEvent);
  }
  startNextPlanTask(agentState, emitAgentEvent, 'Continuing with the next implementation, packaging, or verification step.');
}

