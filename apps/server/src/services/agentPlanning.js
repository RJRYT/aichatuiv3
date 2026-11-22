export function createTaskPlan(args, agentState = {}, onAgentEvent) {
  const objective = String(args.objective || '')
    .trim()
    .slice(0, 500);
  if (!objective) throw new Error('A task-plan objective is required.');
  if (!Array.isArray(args.tasks) || !args.tasks.length || args.tasks.length > 12)
    throw new Error('A plan must contain between 1 and 12 tasks.');
  const ids = new Set();
  const tasks = args.tasks.map((task, index) => {
    const id = String(task?.id || `task-${index + 1}`).trim();
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || ids.has(id))
      throw new Error(`Invalid or duplicate task ID: ${id}`);
    ids.add(id);
    return {
      id,
      title: String(task?.title || '')
        .trim()
        .slice(0, 100),
      description: String(task?.description || '')
        .trim()
        .slice(0, 300),
      dependsOn: Array.isArray(task?.depends_on) ? task.depends_on.map(String) : [],
      status: 'pending',
      note: '',
    };
  });
  for (const task of tasks) {
    if (!task.title) throw new Error(`Task ${task.id} needs a title.`);
    if (task.dependsOn.some((id) => !ids.has(id) || id === task.id))
      throw new Error(`Task ${task.id} has an invalid dependency.`);
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set(),
    visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error('Task plan contains a dependency cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependsOn) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
  const plan = { objective, tasks, createdAt: new Date().toISOString() };
  agentState.plan = plan;
  onAgentEvent?.('plan_created', { plan });
  return { plan };
}

export function updatePlannedTask(args, agentState = {}, onAgentEvent) {
  const plan = agentState.plan;
  if (!plan) throw new Error('There is no active task plan. Create a plan first.');
  const task = plan.tasks.find((item) => item.id === String(args.task_id || ''));
  if (!task) throw new Error('Task was not found in the active plan.');
  const next = String(args.status || '');
  if (!['pending', 'running', 'completed', 'failed', 'skipped'].includes(next))
    throw new Error('Invalid task status.');
  if (next === 'running' || next === 'completed') {
    const blocked = task.dependsOn.filter(
      (id) => plan.tasks.find((item) => item.id === id)?.status !== 'completed'
    );
    if (blocked.length)
      throw new Error(`Task is blocked until dependencies are completed: ${blocked.join(', ')}`);
  }
  if (task.status === 'completed' && next !== 'completed')
    throw new Error('A completed task cannot be reopened.');
  if (task.status === 'skipped' && next !== 'skipped')
    throw new Error('A skipped task cannot be reopened.');
  if (next === 'completed' && task.status !== 'running')
    throw new Error('Mark the task running before marking it completed.');
  task.status = next;
  task.note = String(args.note || '')
    .trim()
    .slice(0, 500);
  task.updatedAt = new Date().toISOString();
  onAgentEvent?.('task_updated', { task: { ...task }, plan });
  return { task: { ...task }, plan };
}
