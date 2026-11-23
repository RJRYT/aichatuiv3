import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('agent loop uses automatic model tool choice without mandatory progress or deliverable routing', async () => {
  const source = await read('../src/services/nvidia.js');
  assert.match(source, /tool_choice:\s*'auto'/);
  assert.doesNotMatch(
    source,
    /detectDeliverableContract|deliverableContract|expectedToolName|requiredToolName|forceRequiredTool|progressReported/
  );
  assert.doesNotMatch(
    source,
    /required operation has not been executed|Call report_progress again/
  );
});

test('native workspace operations are distinct from Python and Node execution', async () => {
  const tools = await read('../src/services/tools.js');
  for (const name of [
    'workspace_list',
    'workspace_read',
    'workspace_create',
    'workspace_edit',
    'workspace_delete',
    'workspace_search',
    'workspace_status',
    'workspace_archive',
    'execute_python',
    'execute_node',
  ]) {
    assert.match(tools, new RegExp(`name: '${name}'`));
  }
  assert.match(tools, /do not start Python merely to write files/i);
  assert.match(tools, /VERCEL_NODE_SANDBOX_IMAGE/);
});

test('project prompt makes planning, progress, execution and packaging model-directed', async () => {
  const prompt = await read('../prompts/system-prompt.md');
  assert.match(prompt, /Progress updates are optional/i);
  assert.match(prompt, /You decide whether to use the planning tools/i);
  assert.match(prompt, /Use native workspace tools instead/i);
  assert.match(prompt, /Package a project only when the user requests an archive/i);
  assert.doesNotMatch(prompt, /Generate actual files with `execute_python`/i);
});
