import crypto from 'node:crypto';
import { getToolDefinitions, runTool } from './tools.js';
import { buildSystemPrompt } from './systemPrompt.js';
import logger from '../utils/logger.js';

export const MODEL_ID = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const log = logger.child({ component: 'nvidia' });
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_TOOL_ROUNDS = 8;
function sse(res, payload) { if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`); }
function parseToolArgs(raw) { try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; } }
function systemPrompt(user) { return buildSystemPrompt(user); }
async function requestRound({ messages, tools, thinkingEnabled, signal, res, round, hasVision }) {
  log.debug('NVIDIA request round', { round, toolCount: tools.length, hasVision });
  const body = {
    model: MODEL_ID, messages, temperature: hasVision ? 0.6 : 1.0, top_p: 0.95,
    stream: true,
    chat_template_kwargs: { enable_thinking: Boolean(thinkingEnabled) },
    ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {})
  };
  const response = await fetch(NVIDIA_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  if (!response.ok) { const detail = (await response.text()).slice(0, 9000); throw Object.assign(new Error(`NVIDIA NIM returned HTTP ${response.status}: ${detail}`), { status: response.status }); }
  if (!response.body) throw new Error('NVIDIA returned an empty streaming response body.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', content = '', reasoning = '', finishReason = null, usage = null; const calls = new Map();
  const handleLine = line => {
    const trimmed = line.trim(); if (!trimmed.startsWith('data:')) return;
    const raw = trimmed.slice(5).trim(); if (!raw || raw === '[DONE]') return;
    let data; try { data = JSON.parse(raw); } catch { return; }
    const choice = data.choices?.[0], delta = choice?.delta || {};
    if (typeof delta.content === 'string' && delta.content) { content += delta.content; sse(res, { type: 'chunk', round, content: delta.content }); }
    const thought = delta.reasoning_content ?? delta.reasoning;
    if (typeof thought === 'string' && thought) { reasoning += thought; sse(res, { type: 'reasoning', round, content: thought }); }
    if (Array.isArray(delta.tool_calls)) for (const item of delta.tool_calls) {
      const index = Number(item.index ?? 0), current = calls.get(index) || { index, id: '', type: 'function', function: { name: '', arguments: '' } };
      if (item.id && !current.id) current.id = item.id;
      if (item.function?.name) current.function.name += item.function.name;
      if (item.function?.arguments) current.function.arguments += item.function.arguments;
      calls.set(index, current); sse(res, { type: 'tool_call_delta', round, index, name: current.function.name });
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (data.usage) usage = data.usage;
  };
  try {
    let done = false;
    while (!done) { const part = await reader.read(); done = part.done; buffer += decoder.decode(part.value || new Uint8Array(), { stream: !done }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(handleLine); }
    if (buffer.trim()) handleLine(buffer);
  } finally { reader.releaseLock(); }
  return { content, reasoning, finishReason, usage, toolCalls: [...calls.values()].sort((a, b) => a.index - b.index) };
}
export async function runNemotronChat({ body, req, res, persist, user }) {
  if (!process.env.NVIDIA_API_KEY) {
    log.error('NVIDIA_API_KEY is missing on the backend.');
    throw Object.assign(new Error('NVIDIA_API_KEY is missing on the backend.'), { status: 503 });
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    log.warn('Invalid chat request: empty messages');
    throw Object.assign(new Error('A non-empty messages array is required.'), { status: 400 });
  }
  const userId = user?._id ? String(user._id) : 'unknown';
  log.info('Chat generation started', { userId, messageCount: body.messages.length, hasVision: body.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')) });
  const tools = getToolDefinitions();
  const input = body.messages.map(m => {
    const files = Array.isArray(m.attachments) ? m.attachments.filter(file => file?.sandboxPath?.startsWith('uploads/')) : [];
    let content = m.content;
    if (files.length && m.role === 'user') {
      const fileContext = `User-provided files are available to execute_python in this conversation's sandbox workspace:\n${files.map(file => `- ${file.name} (${file.type || 'file'}, ${Number(file.size) || 'unknown'} bytes): ${file.sandboxPath}`).join('\n')}\nUse these exact paths with Python pathlib/open; do not guess filenames. The execution service verifies each file's stored bytes and mounts it before running Python. If the execution tool reports a mount/integrity error, report that error rather than claiming the file is empty.`;
      content = Array.isArray(content) ? [{ type: 'text', text: fileContext }, ...content] : `${String(content || '')}\n\n${fileContext}`;
    }
    return { role: m.role, content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}), ...(m.name ? { name: m.name } : {}) };
  });
  const messages = [{ role: 'system', content: systemPrompt(user) }, ...input];
  const hasVision = input.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
  const controller = new AbortController(); const onClose = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', onClose);
  const startedAt = Date.now(); let finalUsage = null, finalText = '', finalReasoning = '', rounds = 0, toolEvents = [];
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      rounds = round + 1; sse(res, { type: 'status', status: round === 0 ? 'Thinking…' : 'Reviewing plugin results…', round });
      const result = await requestRound({ messages, tools, thinkingEnabled: body.thinkingEnabled !== false, signal: controller.signal, res, round, hasVision });
      finalUsage = result.usage || finalUsage; finalText += result.content; finalReasoning += result.reasoning;
      if (!result.toolCalls.length) break;
      if (round === MAX_TOOL_ROUNDS) throw new Error('Plugin execution exceeded the safety limit.');
      const calls = result.toolCalls.map((call, index) => ({ id: call.id || `call_${round}_${index}`, type: 'function', function: { name: call.function.name, arguments: call.function.arguments || '{}' } }));
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: calls });
      for (const call of calls) {
        const name = call.function.name, args = parseToolArgs(call.function.arguments);
        const safeArgs = name === 'execute_python' ? { task_context: args.task_context || '', code_bytes: Buffer.byteLength(String(args.code || ''), 'utf8') } : args;
        sse(res, { type: 'tool_start', name, arguments: safeArgs, round });
        const outcome = await runTool(name, args, user, { signal: controller.signal, chatId: body.chatId });
        const toolCompleted = outcome.ok && (name !== 'execute_python' || outcome.result?.status === 'completed');
        const event = { name, arguments: safeArgs, status: toolCompleted ? 'complete' : 'error', result: outcome.ok ? outcome.result : undefined, error: outcome.ok ? (name === 'execute_python' && outcome.result?.status !== 'completed' ? outcome.result?.stderr || `Python execution ${outcome.result?.status || 'failed'}.` : undefined) : outcome.error };
        toolEvents.push(event); sse(res, { type: 'tool_result', ...event, round });
        messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(outcome) });
      }
    }
    const visible = body.messages.filter(m => m.role !== 'system' && m.role !== 'tool');
    await persist?.([...visible, { id: String(body.assistantMessageId || crypto.randomUUID()), role: 'assistant', content: finalText, reasoning: finalReasoning, usage: finalUsage, toolEvents, createdAt: new Date().toISOString() }]);
    log.info('Chat generation completed', { userId, rounds, durationMs: Date.now() - startedAt, toolEventCount: toolEvents.length, usage: finalUsage });
    sse(res, { type: 'done', usage: finalUsage, durationMs: Date.now() - startedAt, toolRounds: rounds });
  } catch (error) {
    if (error.name === 'AbortError') {
      log.warn('Chat generation aborted by client', { userId });
      sse(res, { type: 'stopped' });
    } else {
      log.error('Chat generation failed', { userId, error: error instanceof Error ? { message: error.message, stack: error.stack, status: error.status } : String(error) });
      sse(res, { type: 'error', status: error.status || 502, error: error.message || 'NVIDIA request failed.' });
    }
  } finally { res.off('close', onClose); if (!res.writableEnded) res.end(); }
}
export async function generateChatTitle(text) {
  const response = await fetch(NVIDIA_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL_ID, messages: [{ role: 'system', content: 'Generate a concise, specific chat title of 3 to 8 words using the full conversation context. Focus on the user objective, not greetings or generic assistant text. Consider tool activity only when it materially clarifies the task. Return only the title, no quotes or punctuation.' }, { role: 'user', content: String(text).slice(0, 9000) }], temperature: 0.2, top_p: 0.95, max_tokens: 32, stream: false, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Title generation failed with HTTP ${response.status}.`);
  const data = await response.json(); return String(data.choices?.[0]?.message?.content || '').trim().replace(/^['"`]|['"`]$/g, '').slice(0, 72) || 'New chat';
}
