import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initializePlanProgress,
  advancePlanAfterExecution,
  startNextPlanTask,
} from '../src/services/agentPlanProgress.js';

function createState() {
  return {
    plan: {
      objective: 'Build a website and package it',
      tasks: [
        {
          id: '1',
          title: 'Define requirements and design',
          description: 'Review requirements and define the design direction.',
          dependsOn: [],
          status: 'pending',
          note: '',
        },
        {
          id: '2',
          title: 'Implement the website',
          description: 'Create the complete responsive website source files.',
          dependsOn: ['1'],
          status: 'pending',
          note: '',
        },
        {
          id: '3',
          title: 'Run QA and package ZIP',
          description: 'Run checks, create the archive, and verify its integrity.',
          dependsOn: ['2'],
          status: 'pending',
          note: '',
        },
      ],
    },
  };
}

test('plan progress advances from planning to implementation without model status calls', () => {
  const state = createState();
  const events = [];
  const emit = (type, data) => events.push({ type, ...data });
  initializePlanProgress(state, emit);
  assert.equal(state.plan.tasks[0].status, 'completed');
  assert.equal(state.plan.tasks[1].status, 'running');
  assert.equal(events.filter((event) => event.type === 'task_updated').length, 2);
});

test('successful execution advances to the next pending task and verified delivery completes the plan', () => {
  const state = createState();
  const emit = () => {};
  initializePlanProgress(state, emit);
  advancePlanAfterExecution(state, emit, false);
  assert.equal(state.plan.tasks[1].status, 'completed');
  assert.equal(state.plan.tasks[2].status, 'running');
  advancePlanAfterExecution(state, emit, true);
  assert.ok(state.plan.tasks.every((task) => task.status === 'completed'));
});


test('startNextPlanTask is exported for the NVIDIA execution service', () => {
  const state = createState();
  const emit = () => {};
  const task = startNextPlanTask(state, emit, 'Execution is starting.');
  assert.equal(task.id, '1');
  assert.equal(task.status, 'running');
});

test('failed final verification never marks the complete plan as finished', () => {
  const state = createState();
  const emit = () => {};
  initializePlanProgress(state, emit);
  advancePlanAfterExecution(state, emit, false);
  assert.equal(state.plan.tasks[1].status, 'completed');
  assert.equal(state.plan.tasks[2].status, 'running');
  advancePlanAfterExecution(state, emit, false);
  assert.equal(state.plan.tasks[2].status, 'pending');
  assert.equal(state.plan.tasks.every((task) => ['completed', 'skipped'].includes(task.status)), false);
});
