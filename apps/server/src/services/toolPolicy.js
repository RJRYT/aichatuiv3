const USER_CONFIGURABLE_TOOLS = new Set([
  'execute_python',
  'execute_node',
  'web_search',
  'generate_image',
  'workspace_delete',
  'workspace_archive',
]);

export function isToolUserConfigurable(toolId) {
  return USER_CONFIGURABLE_TOOLS.has(String(toolId || ''));
}

export function isPluginEnabled(user, pluginId) {
  if (!isToolUserConfigurable(pluginId)) return true;
  const permissions = user?.pluginPermissions;
  if (!permissions || typeof permissions !== 'object' || permissions[pluginId] === undefined) return true;
  return permissions[pluginId] !== false;
}
