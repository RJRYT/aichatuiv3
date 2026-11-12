export function sanitizeAgentPlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.tasks)) return null;
  const validStatuses = new Set(['pending', 'running', 'completed', 'failed', 'skipped']);
  return {
    objective: String(plan.objective || '').slice(0, 500),
    createdAt: plan.createdAt || null,
    tasks: plan.tasks.slice(0, 12).map((task, index) => ({
      id: String(task?.id || `task-${index + 1}`).slice(0, 32),
      title: String(task?.title || '').slice(0, 100),
      description: String(task?.description || '').slice(0, 300),
      dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map(String).slice(0, 12) : [],
      status: validStatuses.has(task?.status) ? task.status : 'pending',
      note: String(task?.note || '').slice(0, 500),
      ...(task?.updatedAt ? { updatedAt: task.updatedAt } : {}),
    })),
  };
}

function removePrivateReasoning(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const { reasoning, ...safe } = message || {};
    if (Array.isArray(safe.versions)) {
      safe.versions = safe.versions.map((version) => {
        const { reasoning: hiddenReasoning, ...visibleVersion } = version || {};
        return visibleVersion;
      });
    }
    return safe;
  });
}

export function sanitizeRetrievedChat(chat) {
  if (!chat) return chat;
  const safe = { ...chat, messages: removePrivateReasoning(chat.messages) };
  if (Array.isArray(chat.branches)) {
    safe.branches = chat.branches.map((branch) => ({
      ...branch,
      messages: removePrivateReasoning(branch.messages),
    }));
  }
  return safe;
}
