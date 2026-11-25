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


test('starter suggestions are model-generated even with no previous chats', async () => {
  const client = await read('../../client/src/App.jsx');
  const route = await read('../src/routes/chat.js');
  const nvidia = await read('../src/services/nvidia.js');
  assert.match(client, /starter-suggestions/);
  assert.match(client, /setStarterSuggestions\(\[\]\)/);
  assert.match(route, /generateStarterSuggestions/);
  assert.match(nvidia, /export async function generateStarterSuggestions/);
  assert.match(nvidia, /available capabilities/);
});

test('recovery actions are generated from the exact failed assistant response', async () => {
  const client = await read('../../client/src/App.jsx');
  const route = await read('../src/routes/chat.js');
  const nvidia = await read('../src/services/nvidia.js');
  assert.match(route, /assistant\.error \|\| assistant\.stopReason \|\| assistant\.executionStatus/);
  assert.match(nvidia, /error: String\(error \|\| ''\)/);
  assert.match(client, /message\.suggestedNextSteps\.slice\(0, 3\)/);
  assert.doesNotMatch(client, /Continue from saved progress|Retry task/);
});

test('chat navigation keeps background generations scoped and does not steal the refresh route', async () => {
  const client = await read('../../client/src/App.jsx');
  const route = await read('../src/routes/chat.js');
  assert.match(client, /generationControllersRef = useRef\(new Map\(\)\)/);
  assert.match(client, /setGenerationChats\(\(current\) => new Set\(current\)\.add\(chat\._id\)\)/);
  assert.match(client, /generationControllersRef\.current\.get\(id\)/);
  assert.doesNotMatch(client, /setPendingRecovery\(parsed\)/);
  assert.match(client, /stream\/recent/);
  assert.match(route, /getRecentGenerationSessions/);
});

test('YouTube tools are backed by ytsearch.js and cover search, details and playlist retrieval', async () => {
  const tools = await read('../src/services/tools.js');
  const serverPackage = JSON.parse(await read('../package.json'));
  assert.equal(serverPackage.dependencies['ytsearch.js'], '2.1.3');
  for (const name of ['youtube_search', 'youtube_video_details', 'youtube_playlist_items']) assert.ok(tools.includes(name));
  assert.match(tools, /await import\('ytsearch\.js'\)/);
  assert.match(tools, /searchYouTube/);
  assert.match(tools, /getVideoDetails/);
  assert.match(tools, /getPlaylistItems/);
});

test('File Library deletes update local state without reloading the full library', async () => {
  const client = await read('../../client/src/App.jsx');
  assert.match(client, /setFiles\(\(current\) => current\.filter\(\(item\) => item\.id !== file\.id\)\)/);
  assert.match(client, /const deletedFiles = selected\.filter/);
  assert.doesNotMatch(client, /setSelectedFileIds\(new Set\(\)\);\s*if \(deletedFiles\.length !== ids\.length\)[\s\S]{0,120}await load\(\)/);
});

test('tool activity groups show latest call first and sort the most recently used group last', async () => {
  const client = await read('../../client/src/App.jsx');
  assert.match(client, /\.sort\(\(a, b\) => a\.lastIndex - b\.lastIndex\)/);
  assert.match(client, /group\.events\[group\.events\.length - 1\]/);
  assert.match(client, /\[\.\.\.group\.events\]\.reverse\(\)/);
});


test('progress and stop controls are scoped to the selected conversation', async () => {
  const client = await read('../../client/src/App.jsx');
  assert.match(client, /liveProgressByChat/);
  assert.match(client, /setProgressForChat\(chat\.\_id/);
  assert.match(client, /const visibleLiveProgress = activeId \? \(liveProgressByChat\[activeId\]/);
  assert.match(client, /generationControllersRef\.current\.get\(activeIdRef\.current\)/);
});
