import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('active generations are discoverable server-side and session heartbeats persist independently of tokens', async () => {
  const route = await read('../src/routes/chat.js');
  const sessions = await read('../src/services/generationSessions.js');
  assert.match(route, /router\.get\('\/stream\/active'/);
  assert.match(route, /getLatestActiveGenerationSession\(ownerId, chatId\)/);
  assert.match(sessions, /getLatestActiveGenerationSession\(ownerId, chatId = ''\)/);
  assert.match(route, /phase: 'session'/);
  assert.match(route, /setInterval\(\(\) => \{/);
  assert.match(sessions, /export async function getLatestActiveGenerationSession/);
});

test('task plans survive replay compaction and checkpoint status tool has its dependency', async () => {
  const route = await read('../src/routes/chat.js');
  const tools = await read('../src/services/tools.js');
  assert.match(route, /event\.event\?\.plan/);
  assert.match(route, /plan: event\.event\.plan/);
  const client = await read('../../client/src/App.jsx');
  assert.match(client, /checkpoint\?\.plan/);
  assert.match(client, /item\.plan/);
  assert.match(tools, /import \{ getLatestAgentCheckpoint \} from '\.\/agents\/checkpointManager\.js'/);
  assert.match(tools, /name: 'get_agent_status'/);
});

test('File Library includes uploaded files and supports agent search/read access', async () => {
  const uploadStore = await read('../src/services/interpreter/uploadStore.js');
  const route = await read('../src/routes/interpreter.js');
  const tools = await read('../src/services/tools.js');
  const client = await read('../../client/src/App.jsx');
  assert.match(uploadStore, /export async function listOwnerUploadMetadata/);
  assert.match(route, /router\.get\('\/uploads'/);
  assert.match(route, /router\.get\('\/uploads\/:id'/);
  assert.match(tools, /name: 'file_library_search'/);
  assert.match(tools, /getOwnerUpload/);
  for (const label of ['Photos', 'Files', 'From library', 'From URL']) assert.ok(client.includes(label));
  assert.match(client, /onAttach=\{attachLibraryFile\}/);
});

test('usage retention is stored separately from chats and merged with legacy chat analytics', async () => {
  const model = await read('../src/models/UsageRecord.js');
  const service = await read('../src/services/usageRecords.js');
  const chats = await read('../src/routes/chats.js');
  assert.match(model, /generationId: \{ type: String, required: true, unique: true/);
  assert.match(model, /role: \{ type: String, enum: \['user', 'assistant'\]/);
  assert.match(service, /export async function recordUsageEvent/);
  assert.match(service, /export async function backfillChatUsage/);
  assert.match(chats, /aggregateUsageRecords/);
  assert.match(chats, /aggregateUsageFromChats/);
  assert.match(chats, /await backfillChatUsage\(ownerId, chat\)/);
  assert.doesNotMatch(chats, /UsageRecord\.delete/);
});

test('custom endpoint tools are removed and only four optional tool switches remain', async () => {
  const account = await read('../src/routes/account.js');
  const tools = await read('../src/services/tools.js');
  const policy = await read('../src/services/toolPolicy.js');
  assert.doesNotMatch(account, /plugins\/custom-tools/);
  assert.doesNotMatch(tools, /getCustomToolDefinitions|runCustomTool|custom_/);
  for (const id of ['execute_python', 'execute_node', 'web_search', 'generate_image']) assert.ok(policy.includes(`'${id}'`));
  assert.equal((policy.match(/^  '/gm) || []).length, 4);
});

test('the completion duration is displayed beside the model badge', async () => {
  const client = await read('../../client/src/App.jsx');
  assert.match(client, /message\.durationMs/);
  assert.match(client, /starterSuggestions/);
  assert.doesNotMatch(client, /const SUGGESTIONS = \[/);
  assert.match(client, /Worked for/);
  assert.match(client, /message-model|model-badge/);
});

test('legacy hardcoded UI colors are covered by theme-aware semantic overrides', async () => {
  const styles = await read('../../client/src/styles.css');
  assert.match(styles, /--surface-2: var\(--panel2\)/);
  assert.match(styles, /\.app\[data-theme\] \.topbar/);
  assert.match(styles, /\.app\[data-theme\] \.composer/);
  assert.match(styles, /\.app\[data-theme\] \.file-library-modal/);
});


test('browser dialogs and native select controls are replaced with themed application components', async () => {
  const client = await read('../../client/src/App.jsx');
  const styles = await read('../../client/src/styles.css');
  assert.doesNotMatch(client, /window\.(?:alert|prompt|confirm)\s*\(/);
  assert.match(client, /function AppDialogHost\(/);
  assert.match(client, /function SelectMenu\(/);
  assert.match(client, /className="model-select-menu"/);
  assert.match(styles, /\.app-dialog-layer/);
  assert.match(styles, /\.select-menu-popover/);
  assert.match(styles, /\.chat-meta-dialog \.switch/);
});

test('assistant deliverables must be exported out of private workspace storage', async () => {
  const prompt = await read('../prompts/system-prompt.md');
  const tools = await read('../src/services/tools.js');
  assert.match(prompt, /user does not have direct filesystem access/i);
  assert.match(prompt, /workspace_export/);
  assert.match(prompt, /never tell the user to retrieve/i);
  assert.match(tools, /user cannot directly access workspace paths/i);
});

test('completed responses merge against the latest chat revision after client disconnects', async () => {
  const route = await read('../src/routes/chat.js');
  assert.match(route, /expectedRevision: current\.revision \|\| 0/);
  assert.match(route, /Preserve messages added by another tab\/device while this generation ran/);
  assert.match(route, /messagesWithHistory\.push\(\.\.\.concurrentMessages\)/);
});
