import test from 'node:test';
import assert from 'node:assert/strict';
import { isPluginEnabled, isToolUserConfigurable } from '../src/services/toolPolicy.js';

test('only the four requested optional tools expose permission switches', () => {
  for (const id of ['execute_python', 'execute_node', 'web_search', 'generate_image']) assert.equal(isToolUserConfigurable(id), true, `${id} should be configurable`);
  for (const id of ['workspace_delete', 'workspace_archive', 'workspace_list', 'calculator', 'github_search']) assert.equal(isToolUserConfigurable(id), false, `${id} should not be configurable`);
});

test('core tools remain enabled regardless of legacy plugin permission settings', () => {
  assert.equal(isPluginEnabled({ pluginPermissions: { workspace_delete: false } }, 'workspace_delete'), true);
  assert.equal(isPluginEnabled({ pluginPermissions: { calculator: false } }, 'calculator'), true);
});

test('the four optional tools respect explicit user permission switches', () => {
  assert.equal(isPluginEnabled({ pluginPermissions: { execute_python: false } }, 'execute_python'), false);
  assert.equal(isPluginEnabled({ pluginPermissions: { execute_node: true } }, 'execute_node'), true);
});
