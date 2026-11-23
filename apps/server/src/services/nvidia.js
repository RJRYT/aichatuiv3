import crypto from 'node:crypto';
import logger from '../utils/logger.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { createAgentCheckpoint, finishAgentCheckpoint, getLatestAgentCheckpoint, updateAgentCheckpoint } from './agents/checkpointManager.js';
import { getToolDefinitions, runTool } from './tools.js';
import { MODEL_REGISTRY, DEFAULT_MODEL_ALIAS, getModel } from './modelRegistry.js';
import { routeModel, escalationTarget, isEscalatableModelError, requiresToolCapableModel, isEmptyModelResponse } from './modelRouter.js';
import { decryptUserIntegrations } from './integrations/crypto.js';

export const MODEL_ID = MODEL_REGISTRY.vision.id;
const log = logger.child({ component: 'nvidia' });
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_TOOL_ROUNDS = Math.max(16, Math.min(128, Number(process.env.AGENT_MAX_MODEL_ROUNDS) || 96));
const MAX_EXECUTION_TOOL_CALLS = Math.max(8, Math.min(128, Number(process.env.AGENT_MAX_TOOL_CALLS) || 64));
const MAX_RECOVERY_ATTEMPTS_PER_TOOL = Math.max(1, Math.min(5, Number(process.env.AGENT_MAX_RECOVERY_ATTEMPTS) || 3));
const MODEL_STREAM_IDLE_TIMEOUT_MS = 90_000;
const MODEL_ROUND_TIMEOUT_MS = 10 * 60_000;
const CHAT_TURN_TIMEOUT_MS = 15 * 60_000;
const MODEL_HEARTBEAT_INTERVAL_MS = 20_000;

function sse(res, payload) {
  if (!res.writableEnded && !res.destroyed) {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); }
    catch (error) { log.debug('SSE write skipped after connection close', { error: error.message }); }
  }
}
function stripInternalArtifactUrls(value) {
  if (Array.isArray(value)) return value.map(stripInternalArtifactUrls);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key === 'downloadUrl' &&
      typeof item === 'string' &&
      item.startsWith('/api/interpreter/artifacts/')
    ) {
      continue;
    }
    output[key] = stripInternalArtifactUrls(item);
  }
  return output;
}

function parseToolArgs(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${error.message}`);
  }
}

function safeToolArguments(name, args = {}) {
  if (name === 'execute_python') return { task_context: String(args.task_context || '').slice(0, 500), code_bytes: Buffer.byteLength(String(args.code || ''), 'utf8') };
  if (name === 'workspace_create') return { path: args.path, overwrite: Boolean(args.overwrite), content_bytes: Buffer.byteLength(String(args.content || ''), 'utf8') };
  if (name === 'workspace_edit') return { path: args.path, mode: args.mode, expectedRevision: args.expectedRevision, old_text_bytes: Buffer.byteLength(String(args.oldText || ''), 'utf8'), new_text_bytes: Buffer.byteLength(String(args.newText || args.content || ''), 'utf8') };
  if (name === 'workspace_read' || name === 'workspace_delete') return { path: args.path };
  if (name === 'workspace_search') return { query: String(args.query || '').slice(0, 120), prefix: args.prefix || '' };
  if (name === 'execute_node') return { command: args.command, args: Array.isArray(args.args) ? args.args.slice(0, 20) : [], timeout_ms: args.timeout_ms };
  if (name === 'workspace_export') return { path: args.path, name: args.name || '' };
  if (name === 'workspace_archive') return { name: args.name || 'project.zip' };
  if (name === 'save_memory') return { memory_characters: String(args.memory || '').length };
  if (name === 'search_memories') return { query_characters: String(args.query || '').length };
  if (name === 'list_shared_links') return { limit: args.limit };
  if (name === 'search_previous_chats') return { query: String(args.query || '').slice(0, 80), limit: args.limit };
  if (name === 'fetch_public_url') { try { const url = new URL(String(args.url || '')); return { url: `${url.origin}${url.pathname}` }; } catch { return { url: '[invalid URL]' }; } }
  if (name.startsWith('custom_')) return { argumentNames: Object.keys(args).slice(0, 20) };
  return args;
}

function safeToolEventResult(name, result) {
  if (!result || typeof result !== 'object') return result;
  if (name === 'workspace_read') return { path: result.path, size: result.size, revision: result.revision, sha256: result.sha256, contentBytes: Buffer.byteLength(String(result.content || ''), 'utf8') };
  if (name === 'workspace_search') return { query: result.query, resultCount: result.results?.length || 0, truncated: Boolean(result.truncated) };
  if (name === 'execute_python') return { status: result.status, exitCode: result.exitCode, durationMs: result.durationMs, artifactNames: (result.artifacts || []).map((item) => item.name).slice(0, 20) };
  if (name === 'execute_node') return { runtime: 'node', status: result.status, exitCode: result.exitCode, durationMs: result.durationMs };
  if (name === 'web_search') return { query: result.query, resultCount: result.results?.length || 0 };
  if (name === 'fetch_public_url') return { url: result.url, contentType: result.contentType, contentBytes: Buffer.byteLength(String(result.content || ''), 'utf8') };
  if (name === 'generate_image') return { status: result.status, artifactNames: (result.artifacts || []).map((item) => item.name).slice(0, 4) };
  if (name === 'save_memory') return { saved: result.saved, duplicate: result.duplicate, totalMemories: result.totalMemories };
  if (name === 'search_memories') return { memoryCount: result.memories?.length || 0 };
  if (name === 'search_previous_chats') return { resultCount: result.results?.length || 0 };
  if (name === 'list_shared_links') return { shareCount: result.shares?.length || 0 };
  return result;
}
export function countsTowardExecutionLimit(toolName) {
  return !['create_task_plan', 'update_task_status', 'report_progress', 'get_agent_status'].includes(toolName);
}
export function normalizeActivePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.tasks)) return null;
  const allowed = new Set(['pending', 'running', 'completed', 'failed', 'skipped']);
  const tasks = plan.tasks.slice(0, 12).map((task, index) => ({
    id: String(task?.id || `task-${index + 1}`).slice(0, 32),
    title: String(task?.title || `Task ${index + 1}`).slice(0, 100),
    description: String(task?.description || '').slice(0, 300),
    dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map(String).slice(0, 12) : [],
    status: allowed.has(task?.status) ? task.status : 'pending',
    note: String(task?.note || '').slice(0, 500),
    ...(task?.updatedAt ? { updatedAt: task.updatedAt } : {}),
  }));
  if (!tasks.length) return null;
  if (tasks.every((task) => ['completed', 'skipped'].includes(task.status))) return null;
  return {
    objective: String(plan.objective || 'Continue the existing task plan').slice(0, 500),
    tasks,
    createdAt: plan.createdAt || new Date().toISOString(),
  };
}

function systemPrompt(user) {
  return buildSystemPrompt(user);
}
export async function requestRound({
  messages,
  tools = [],
  thinkingEnabled = false,
  signal,
  res,
  round,
  hasVision,
  idleTimeoutMs = MODEL_STREAM_IDLE_TIMEOUT_MS,
  roundTimeoutMs = MODEL_ROUND_TIMEOUT_MS,
  heartbeatIntervalMs = MODEL_HEARTBEAT_INTERVAL_MS,
  modelId = MODEL_ID,
  apiKey = process.env.NVIDIA_API_KEY,
}) {
  const modelConfig = Object.values(MODEL_REGISTRY).find((model) => model.id === modelId) || MODEL_REGISTRY.surge;
  const body = {
    model: modelId,
    messages,
    temperature: hasVision ? 0.6 : modelConfig.temperature,
    top_p: 0.95,
    max_tokens: modelConfig.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
    chat_template_kwargs: { enable_thinking: Boolean(thinkingEnabled) },
    ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
  };
  const requestController = new AbortController();
  let reader;
  let timeoutError = null;
  let idleTimer;
  const failRequest = (error) => {
    if (timeoutError) return;
    timeoutError = error;
    requestController.abort(error);
  };
  const abortRequest = () => failRequest(signal.reason || Object.assign(new Error('The chat request was cancelled.'), { name: 'AbortError' }));
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => failRequest(Object.assign(
      new Error(`The AI model did not send a response for ${Math.ceil(idleTimeoutMs / 1000)} seconds. Please retry.`),
      { code: 'MODEL_STREAM_IDLE_TIMEOUT', status: 504 }
    )), idleTimeoutMs);
  };
  if (signal?.aborted) abortRequest();
  else signal?.addEventListener('abort', abortRequest, { once: true });
  resetIdleTimer();
  const roundTimer = setTimeout(() => failRequest(Object.assign(
    new Error('The AI model response exceeded its time limit. Please retry.'),
    { code: 'MODEL_ROUND_TIMEOUT', status: 504 }
  )), roundTimeoutMs);
  const heartbeatTimer = setInterval(() => sse(res, {
    type: 'heartbeat', phase: 'model', round,
    message: 'The model is still working.',
  }), heartbeatIntervalMs);
  try {
    const response = await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: requestController.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 9000);
      throw Object.assign(new Error(`NVIDIA NIM returned HTTP ${response.status}: ${detail}`), { status: response.status });
    }
    if (!response.body) throw new Error('NVIDIA returned an empty streaming response body.');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', finishReason = null, usage = null;
    const calls = new Map();
    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === '[DONE]') return;
      let data;
      try { data = JSON.parse(raw); } catch { return; }
      const choice = data.choices?.[0], delta = choice?.delta || {};
      // Buffer model text until the round is complete. Tool-call rounds often contain
      // internal narration before the function call; never stream that narration to users.
      if (typeof delta.content === 'string' && delta.content) content += delta.content;
      if (Array.isArray(delta.tool_calls)) for (const item of delta.tool_calls) {
        const index = Number(item.index ?? 0);
        const current = calls.get(index) || { index, id: '', type: 'function', function: { name: '', arguments: '' } };
        if (item.id && !current.id) current.id = item.id;
        if (item.function?.name) current.function.name += item.function.name;
        if (item.function?.arguments) current.function.arguments += item.function.arguments;
        calls.set(index, current);
        sse(res, { type: 'tool_call_delta', round, index, name: current.function.name });
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data.usage) usage = data.usage;
    };
    let done = false;
    while (!done) {
      const part = await reader.read();
      if (part.value?.byteLength) resetIdleTimer();
      done = part.done;
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(handleLine);
    }
    if (buffer.trim()) handleLine(buffer);
    const toolCalls = [...calls.values()].sort((a, b) => a.index - b.index);
    if (!toolCalls.length && content) sse(res, { type: 'chunk', round, content });
    return { content, finishReason, usage, toolCalls };
  } catch (error) {
    if (timeoutError) throw timeoutError;
    throw error;
  } finally {
    if (reader) reader.releaseLock();
    clearTimeout(idleTimer); clearTimeout(roundTimer); clearInterval(heartbeatTimer);
    signal?.removeEventListener('abort', abortRequest);
  }
}

function addUsage(total, next) {
  if (!next || typeof next !== 'object') return total;
  const result = { ...(total || {}) };
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const value = Number(next[key]);
    if (Number.isFinite(value)) result[key] = (Number(result[key]) || 0) + value;
  }
  for (const key of ['prompt_tokens_details', 'completion_tokens_details']) {
    if (next[key] && typeof next[key] === 'object') {
      result[key] = { ...(result[key] || {}) };
      for (const [detail, value] of Object.entries(next[key])) {
        if (Number.isFinite(Number(value))) result[key][detail] = (Number(result[key][detail]) || 0) + Number(value);
      }
    }
  }
  return result;
}

export async function runNemotronChat({ body, req, res, persist, user }) {
  const integrations = decryptUserIntegrations(user);
  if (integrations.errors?.nvidia) throw Object.assign(new Error('Your saved NVIDIA credentials could not be decrypted. Re-enter them in Developer Mode → Personal Integrations.'), { status: 503, code: 'INTEGRATION_DECRYPTION_FAILED' });
  const nvidiaApiKey = integrations.nvidia?.apiKey || process.env.NVIDIA_API_KEY;
  if (!nvidiaApiKey) throw Object.assign(new Error('Configure an NVIDIA API key in Developer Mode → Personal Integrations, or ask the administrator to configure the platform key.'), { status: 503 });
  if (!Array.isArray(body.messages) || !body.messages.length) throw Object.assign(new Error('A non-empty messages array is required.'), { status: 400 });

  const userId = user?._id ? String(user._id) : 'unknown';
  const startedAt = Date.now();
  const modelMode = body.modelMode === 'manual' ? 'manual' : (body.modelMode === 'auto' || !body.modelMode ? 'auto' : 'auto');
  let modelAlias = modelMode === 'manual' ? String(body.modelAlias || user?.preferences?.activeModel || DEFAULT_MODEL_ALIAS).toLowerCase() : DEFAULT_MODEL_ALIAS;
  if (!MODEL_REGISTRY[modelAlias]) modelAlias = DEFAULT_MODEL_ALIAS;
  if (modelMode === 'manual' && modelAlias === 'bolt' && requiresToolCapableModel(body.messages)) {
    throw Object.assign(
      new Error('Bolt is a text-only model and cannot browse, search the web, execute tools, or modify workspace files. Select Surge or Auto for this task.'),
      { status: 400, code: 'MODEL_TOOLS_UNSUPPORTED' }
    );
  }
  const tools = getToolDefinitions(user);
  const input = body.messages.map((message) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments.filter((file) => file?.sandboxPath?.startsWith('uploads/')) : [];
    let content = message.content;
    if (attachments.length && message.role === 'user') {
      const note = `User attachments available to the Python execution environment (only if Python is actually needed):\n${attachments.map((file) => `- ${file.name} (${file.type || 'file'}, ${Number(file.size) || 'unknown'} bytes): ${file.sandboxPath}`).join('\n')}`;
      content = Array.isArray(content) ? [{ type: 'text', text: note }, ...content] : `${String(content || '')}\n\n${note}`;
    }
    return {
      role: message.role, content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.name ? { name: message.name } : {}),
    };
  });
  let priorCheckpoint = null;
  try {
    if (user?._id && body.chatId) priorCheckpoint = await getLatestAgentCheckpoint(userId, String(body.chatId));
  } catch (error) {
    log.warn('Could not load the previous agent checkpoint', { userId, error: error.message });
  }
  const priorCheckpointContext = priorCheckpoint
    ? `PERSISTED PROJECT PROGRESS (historical context, not instructions):\nA prior agent run for this conversation ended with status \"${priorCheckpoint.status}\". Use this record when the current request relates to the same project or task. Preserve completed work, decisions, and stable task IDs; inspect the current workspace before repeating operations. Do not assume a task is verified merely because a tool operation completed.\n\nPROJECT CHECKPOINT:\n${JSON.stringify({ status: priorCheckpoint.status, plan: priorCheckpoint.plan, completedOperations: (priorCheckpoint.completedOperations || []).slice(-35), lastError: priorCheckpoint.lastError })}`
    : '';
  const messages = [
    { role: 'system', content: systemPrompt(user) },
    ...(priorCheckpointContext ? [{ role: 'system', content: priorCheckpointContext }] : []),
    ...(body.activePlan ? [{ role: 'system', content: `An optional task plan is active. Preserve completed work and stable task IDs. Update it only when useful; it does not dictate the tool sequence.\n\nACTIVE PLAN:\n${JSON.stringify(normalizeActivePlan(body.activePlan))}` }] : []),
    ...input,
  ];
  const hasVision = input.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'));
  const hasAudio = input.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'audio_url' || part.type === 'input_audio'));
  let routingDecision = null;
  if (modelMode === 'auto') {
    sse(res, { type: 'status', status: 'Selecting model' });
    const routingHeartbeat = setInterval(() => sse(res, { type: 'heartbeat', phase: 'router', message: 'Choosing the best Nemotron model for this task.' }), 4000);
    try {
      routingDecision = await routeModel({ messages: input, apiKey: nvidiaApiKey });
      modelAlias = routingDecision.alias;
    } finally { clearInterval(routingHeartbeat); }
  }
  if (hasAudio && !getModel(modelAlias).supportsAudio) {
    if (modelMode === 'manual') throw Object.assign(new Error(`The ${getModel(modelAlias).name} model does not accept audio input. Select Omni or Auto mode.`), { status: 400, code: 'MODEL_MODALITY_UNSUPPORTED' });
    modelAlias = 'omni';
    routingDecision = { ...(routingDecision || {}), alias: 'omni', taskType: 'audio_understanding', complexity: 'medium', reason: 'The conversation contains audio input, so Auto selected the audio-capable Omni model.', confidence: 1, source: 'capability-guard' };
  } else if (hasVision && !getModel(modelAlias).supportsVision) {
    if (modelMode === 'manual') throw Object.assign(new Error(`The ${getModel(modelAlias).name} model does not accept image input. Select Vision, Omni, or Auto mode.`), { status: 400, code: 'MODEL_MODALITY_UNSUPPORTED' });
    modelAlias = 'vision';
    routingDecision = { ...(routingDecision || {}), alias: 'vision', taskType: 'visual_context', complexity: 'medium', reason: 'The conversation context contains image input, so Auto selected a vision-capable model.', confidence: 1, source: 'capability-guard' };
  }
  let activeModel = getModel(modelAlias);
  let escalated = false;
  const controller = new AbortController();
  const turnTimer = setTimeout(() => controller.abort(Object.assign(new Error('This chat turn exceeded its 15-minute time limit. Please retry.'), { code: 'CHAT_TURN_TIMEOUT', status: 504 })), CHAT_TURN_TIMEOUT_MS);
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);

  let finalUsage = null, finalText = '', rounds = 0, executionToolCalls = 0;
  const usageByModel = {};
  const modelCallsByModel = {};
  if (routingDecision?.routerCalled) modelCallsByModel.bolt = 1;
  if (routingDecision?.usage) {
    finalUsage = addUsage(finalUsage, routingDecision.usage);
    usageByModel.bolt = addUsage(usageByModel.bolt, routingDecision.usage);
  }
  sse(res, { type: 'model_selected', model: { alias: activeModel.alias, name: activeModel.name, id: activeModel.id }, mode: modelMode, routing: routingDecision });
  const toolEvents = [], agentEvents = [];
  const agentState = { plan: normalizeActivePlan(body.activePlan) };
  const failuresByTool = new Map();
  let checkpoint = null;
  try {
    if (user?._id && body.chatId) checkpoint = await createAgentCheckpoint({ ownerId: userId, chatId: String(body.chatId), plan: agentState.plan });
  } catch (error) {
    log.warn('Agent checkpoint initialization failed; continuing without checkpoint persistence', { userId, error: error.message });
  }
  let checkpointWriteQueue = Promise.resolve();
  const saveCheckpoint = (patch) => {
    if (!checkpoint?.runId) return Promise.resolve(null);
    checkpointWriteQueue = checkpointWriteQueue.then(() =>
      updateAgentCheckpoint(userId, checkpoint.runId, patch)
    ).catch((error) => {
      log.warn('Agent checkpoint update failed', { userId, runId: checkpoint.runId, error: error.message });
      return null;
    });
    return checkpointWriteQueue;
  };
  const emitAgentEvent = (type, data = {}) => {
    const summary = type === 'progress_update' ? String(data.message || '').slice(0, 280)
      : type === 'plan_created' ? 'Created an execution plan.'
      : type === 'task_updated' ? `Updated task: ${String(data.task?.title || 'task').slice(0, 100)}`
      : type === 'tool_started' ? `Using ${String(data.label || data.name || 'a tool').replaceAll('_', ' ')}`
      : type === 'tool_completed' ? `Completed ${String(data.label || data.name || 'tool').replaceAll('_', ' ')}`
      : type === 'self_correction' ? `Recovering from ${String(data.tool || 'a tool').replaceAll('_', ' ')}`
      : type === 'agent_completed' ? 'The response is ready.' : '';
    const event = { id: crypto.randomUUID(), type, at: new Date().toISOString(), ...(summary ? { summary } : {}), ...data };
    agentEvents.push(event);
    sse(res, { type: 'agent_event', event });
    return event;
  };

  try {
    let completedNaturally = false;
    let outputContinuations = 0;
    let accumulatedOutput = '';
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      rounds = round + 1;
      if (controller.signal.aborted) throw controller.signal.reason || new Error('Chat cancelled.');
      sse(res, { type: 'status', status: 'Working', round });
      let result;
      modelCallsByModel[activeModel.alias] = (modelCallsByModel[activeModel.alias] || 0) + 1;
      try {
        result = await requestRound({
          messages,
          tools: !activeModel.supportsTools ? [] : executionToolCalls >= MAX_EXECUTION_TOOL_CALLS ? tools.filter((tool) => ['create_task_plan', 'update_task_status', 'report_progress', 'get_agent_status'].includes(tool.function.name)) : tools,
          thinkingEnabled: Boolean(body.thinkingEnabled),
          signal: controller.signal, res, round, hasVision,
          modelId: activeModel.id, apiKey: nvidiaApiKey,
        });
      } catch (error) {
        if (modelMode === 'auto' && !escalated && isEscalatableModelError(error)) {
          const nextAlias = escalationTarget(modelAlias);
          if (nextAlias && nextAlias !== modelAlias) {
            const previous = activeModel;
            modelAlias = nextAlias;
            activeModel = getModel(modelAlias);
            escalated = true;
            sse(res, { type: 'model_switch', from: { alias: previous.alias, name: previous.name }, to: { alias: activeModel.alias, name: activeModel.name, id: activeModel.id }, reason: `The selected model could not complete the request (${error.status || error.code || 'provider error'}). Auto mode escalated to a compatible model.` });
            continue;
          }
        }
        throw error;
      }
      if (result.usage) {
        finalUsage = addUsage(finalUsage, result.usage);
        usageByModel[activeModel.alias] = addUsage(usageByModel[activeModel.alias], result.usage);
      }
      if (isEmptyModelResponse(result)) {
        const emptyError = Object.assign(
          new Error(`${activeModel.name} returned an empty response. The request was not treated as completed.`),
          { status: 502, code: 'MODEL_EMPTY_RESPONSE' }
        );
        if (modelMode === 'auto' && !escalated) {
          const nextAlias = escalationTarget(modelAlias);
          if (nextAlias && nextAlias !== modelAlias) {
            const previous = activeModel;
            modelAlias = nextAlias;
            activeModel = getModel(modelAlias);
            escalated = true;
            sse(res, { type: 'model_switch', from: { alias: previous.alias, name: previous.name }, to: { alias: activeModel.alias, name: activeModel.name, id: activeModel.id }, reason: `${previous.name} returned an empty response. Auto mode escalated to a compatible model.` });
            continue;
          }
        }
        throw emptyError;
      }
      if (!result.toolCalls.length) {
        if (result.finishReason === 'length' && outputContinuations < 4) {
          accumulatedOutput += result.content || '';
          outputContinuations++;
          messages.push({ role: 'assistant', content: result.content || '' });
          messages.push({ role: 'system', content: 'Your previous response was cut off by the model output limit. Continue from the exact point where it stopped. Do not repeat completed content. If the task requires files or actions, use the available tools instead of emitting an incomplete source dump.' });
          continue;
        }
        finalText = accumulatedOutput + (result.content || '');
        completedNaturally = result.finishReason !== 'length';
        break;
      }

      const calls = result.toolCalls.map((call, index) => ({
        id: call.id || `call_${round}_${index}_${crypto.randomUUID()}`,
        type: 'function',
        function: { name: call.function.name, arguments: call.function.arguments || '{}' },
      }));
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: calls });

      for (const call of calls) {
        const name = String(call.function.name || '');
        let args;
        try { args = parseToolArgs(call.function.arguments); }
        catch (error) {
          messages.push({ role: 'tool', tool_call_id: call.id, name: name || 'unknown_tool', content: JSON.stringify({ ok: false, error: `Invalid tool arguments: ${error.message}. Correct the JSON and retry.` }) });
          continue;
        }

        if (name === 'report_progress') {
          const message = String(args.message || '').replace(/\s+/g, ' ').trim().slice(0, 280);
          if (message.length >= 8) emitAgentEvent('progress_update', { message });
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify({ ok: message.length >= 8, displayed: message.length >= 8 }) });
          continue;
        }

        if (executionToolCalls >= MAX_EXECUTION_TOOL_CALLS && countsTowardExecutionLimit(name)) {
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify({ ok: false, error: `This run has reached its ${MAX_EXECUTION_TOOL_CALLS}-operation execution budget. Preserve completed work and provide an honest summary, or ask the user to resume.` }) });
          continue;
        }
        if (countsTowardExecutionLimit(name)) executionToolCalls++;

        const toolStartedAt = new Date().toISOString();
        const toolStartedMs = Date.now();
        const safeArgs = safeToolArguments(name, args);
        sse(res, { type: 'tool_start', name, arguments: safeArgs, round, startedAt: toolStartedAt });
        emitAgentEvent('tool_started', { name, label: name.replaceAll('_', ' '), arguments: safeArgs, round });
        const attempt = (failuresByTool.get(name) || 0) + 1;
        let outcome;
        if (attempt > MAX_RECOVERY_ATTEMPTS_PER_TOOL) {
          outcome = { ok: false, error: `${name} has reached its bounded retry limit for this run. Choose a different approach or explain the remaining limitation.` };
        } else {
          const toolHeartbeat = setInterval(() => sse(res, {
            type: 'heartbeat', phase: 'tool', name,
            message: `Still working: ${name.replaceAll('_', ' ')} is running.`,
            arguments: safeArgs,
          }), 15_000);
          try {
            outcome = await runTool(name, args, user, {
            signal: controller.signal,
            chatId: body.chatId,
            integrations,
            agentState,
            onAgentEvent: (eventType, data) => {
              if ((eventType === 'plan_created' || eventType === 'task_updated') && data.plan) {
                agentState.plan = data.plan;
                void saveCheckpoint({ plan: agentState.plan });
              }
              emitAgentEvent(eventType, data);
            },
          });
          } finally {
            clearInterval(toolHeartbeat);
          }
        }
        const toolCompleted = Boolean(outcome.ok) &&
          (name !== 'execute_python' || outcome.result?.status === 'completed') &&
          (name !== 'generate_image' || outcome.result?.status === 'completed') &&
          (name !== 'execute_node' || outcome.result?.status === 'completed');
        if (toolCompleted) failuresByTool.delete(name);
        else failuresByTool.set(name, attempt);

        const errorText = outcome.ok
          ? name === 'execute_python' && outcome.result?.status !== 'completed'
            ? outcome.result?.stderr || `Python execution ${outcome.result?.status || 'failed'}.`
            : name === 'generate_image' && outcome.result?.status !== 'completed'
              ? outcome.result?.error || 'Image generation did not complete.'
              : name === 'execute_node' && outcome.result?.status !== 'completed'
                ? outcome.result?.stderr || `Node.js execution ${outcome.result?.status || 'failed'}.` : undefined
          : outcome.error;
        const safeOutcome = stripInternalArtifactUrls(outcome);
        const event = {
          name, arguments: safeArgs, status: toolCompleted ? 'complete' : 'error',
          result: safeOutcome.ok ? safeToolEventResult(name, safeOutcome.result) : undefined,
          error: errorText,
          attempt,
          startedAt: toolStartedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - toolStartedMs,
        };
        toolEvents.push(event);
        if (toolCompleted) emitAgentEvent('tool_completed', { name, label: name.replaceAll('_', ' '), attempt });
        else emitAgentEvent('self_correction', {
          tool: name, attempt, maxAttempts: MAX_RECOVERY_ATTEMPTS_PER_TOOL,
          status: attempt >= MAX_RECOVERY_ATTEMPTS_PER_TOOL ? 'retry_limit_reached' : 'diagnosing',
          error: String(errorText || 'Tool did not complete.').slice(0, 1200),
          message: 'The operation failed. Inspect the diagnostic, change the approach, and avoid repeating the same failing call unchanged.',
        });
        sse(res, { type: 'tool_result', ...event, round });

        await saveCheckpoint({
          round,
          executionToolCalls,
          plan: agentState.plan,
          operation: {
            tool: name,
            status: toolCompleted ? 'completed' : 'failed',
            arguments: safeArgs,
            result: safeToolEventResult(name, safeOutcome.result),
            error: String(errorText || '').slice(0, 1000),
            durationMs: Date.now() - toolStartedMs,
          },
        });
        const payload = {
          ...safeOutcome,
          ...(toolCompleted ? {} : { recoveryGuidance: 'Inspect the exact error. If recoverable, correct the inputs or implementation, or select another tool. Previously completed work remains available.' }),
        };
        const serialized = JSON.stringify(payload);
        messages.push({ role: 'tool', tool_call_id: call.id, name, content: serialized.length > 60000 ? `${serialized.slice(0, 60000)}\n[Tool result truncated by the application.]` : serialized });
      }
      if (modelMode === 'auto' && !escalated && [...failuresByTool.values()].some((count) => count >= MAX_RECOVERY_ATTEMPTS_PER_TOOL)) {
        const nextAlias = escalationTarget(modelAlias);
        if (nextAlias) {
          const previous = activeModel;
          modelAlias = nextAlias;
          activeModel = getModel(modelAlias);
          escalated = true;
          sse(res, { type: 'model_switch', from: { alias: previous.alias, name: previous.name }, to: { alias: activeModel.alias, name: activeModel.name, id: activeModel.id }, reason: 'A tool reached its bounded recovery limit. Auto mode escalated to a stronger model to reassess the remaining work.' });
        }
      }
    }

    if (!completedNaturally) {
      messages.push({ role: 'system', content: 'The current execution budget has been reached. Do not call tools. Provide a concise, honest summary of completed work, remaining work, and any blocker. Never claim unverified completion.' });
      modelCallsByModel[activeModel.alias] = (modelCallsByModel[activeModel.alias] || 0) + 1;
      const finalRound = await requestRound({ messages, tools: [], thinkingEnabled: Boolean(body.thinkingEnabled), signal: controller.signal, res, round: rounds, hasVision, modelId: activeModel.id, apiKey: nvidiaApiKey });
      if (finalRound.usage) { finalUsage = addUsage(finalUsage, finalRound.usage); usageByModel[activeModel.alias] = addUsage(usageByModel[activeModel.alias], finalRound.usage); }
      finalText = accumulatedOutput + (finalRound.content || finalText);
    }

    finalText = String(finalText || '').trim();
    if (!finalText) finalText = 'I could not produce a final response. The conversation and completed tool results have been preserved; please retry or resume the task.';
    finalText = finalText.replace(/<attachment>\s*[^<]*?\s*<\/attachment>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    if (agentEvents.length || agentState.plan) emitAgentEvent('agent_completed', { status: 'completed', message: 'The response is ready.' });
    try {
      await checkpointWriteQueue;
      if (checkpoint?.runId) await finishAgentCheckpoint(userId, checkpoint.runId, completedNaturally ? 'completed' : 'interrupted');
    }
    catch (checkpointError) { log.warn('Agent checkpoint finalization failed', { userId, runId: checkpoint?.runId, error: checkpointError.message }); }

    const visible = body.messages.filter((message) => message.role !== 'system' && message.role !== 'tool');
    await persist?.([
      ...visible,
      {
        id: String(body.assistantMessageId || crypto.randomUUID()), role: 'assistant', content: finalText,
        usage: finalUsage, usageByModel, modelCallsByModel, model: { alias: activeModel.alias, name: activeModel.name, id: activeModel.id }, modelMode, routingDecision, toolEvents, agentPlan: agentState.plan, agentEvents,
        startedAt: new Date(startedAt).toISOString(), createdAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
      },
    ]);
    log.info('Chat generation completed', { userId, rounds, durationMs: Date.now() - startedAt, toolEventCount: toolEvents.length, usage: finalUsage, model: activeModel.alias, usageByModel, executionToolCalls });
    sse(res, { type: 'done', usage: finalUsage, usageByModel, modelCallsByModel, model: { alias: activeModel.alias, name: activeModel.name, id: activeModel.id }, modelMode, routingDecision, durationMs: Date.now() - startedAt, toolRounds: rounds, agentPlan: agentState.plan, agentEvents, executionToolCalls });
  } catch (error) {
    try {
      await checkpointWriteQueue;
      if (checkpoint?.runId) await finishAgentCheckpoint(userId, checkpoint.runId, error.name === 'AbortError' ? 'interrupted' : 'failed', error.message);
    }
    catch (checkpointError) { log.warn('Agent checkpoint error state could not be persisted', { userId, runId: checkpoint?.runId, error: checkpointError.message }); }
    if (error.name === 'AbortError' && controller.signal.reason?.code !== 'CHAT_TURN_TIMEOUT') sse(res, { type: 'stopped' });
    else {
      log.error('Chat generation failed', { userId, error: error instanceof Error ? { message: error.message, stack: error.stack, status: error.status } : String(error) });
      sse(res, { type: 'error', status: error.status || 502, error: error.message || 'NVIDIA request failed.' });
    }
  } finally {
    clearTimeout(turnTimer); res.off('close', onClose); if (!res.writableEnded) res.end();
  }
}

export async function generateChatTitle(text, user) {
  const apiKey = decryptUserIntegrations(user).nvidia?.apiKey || process.env.NVIDIA_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Configure an NVIDIA API key to generate conversation titles.'), { status: 503 });
  const response = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_REGISTRY.bolt.id,
      messages: [
        {
          role: 'system',
          content:
            'Generate a concise, specific chat title of 3 to 8 words using the full conversation context. Focus on the user objective, not greetings or generic assistant text. Consider tool activity only when it materially clarifies the task. Return only the title, no quotes or punctuation.',
        },
        { role: 'user', content: String(text).slice(0, 9000) },
      ],
      temperature: 0.2,
      top_p: 0.95,
      max_tokens: 32,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Title generation failed with HTTP ${response.status}.`);
  const data = await response.json();
  return (
    String(data.choices?.[0]?.message?.content || '')
      .trim()
      .replace(/^['"`]|['"`]$/g, '')
      .slice(0, 72) || 'New chat'
  );
}
