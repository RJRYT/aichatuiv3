import test from 'node:test';
import assert from 'node:assert/strict';
import { isPluginEnabled, isToolUserConfigurable } from '../src/services/toolPolicy.js';

test('only high-impact tools expose permission switches; low-risk tools stay enabled', () => {
  assert.equal(isToolUserConfigurable('execute_python'), true);
  assert.equal(isToolUserConfigurable('workspace_delete'), true);
  assert.equal(isToolUserConfigurable('github_search'), false);
  assert.equal(isToolUserConfigurable('npm_search'), false);
  assert.equal(
    isPluginEnabled({ pluginPermissions: { github_search: false } }, 'github_search'),
    true
  );
  assert.equal(
    isPluginEnabled({ pluginPermissions: { execute_python: false } }, 'execute_python'),
    false
  );
  assert.equal(isPluginEnabled({}, 'execute_python'), true);
});
