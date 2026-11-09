import crypto from 'node:crypto';
import { getToolDefinitions, runTool } from './tools.js';
import { buildSystemPrompt } from './systemPrompt.js';
import logger from '../utils/logger.js';
import { classifyUserRequest, collectVerifiedArtifacts, sanitizeAssistantText } from './agentOrchestration.js';

export const MODEL_ID = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const log = logger.child({ component: 'nvidia' });
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_TOOL_ROUNDS = 12;
const MAX_RECOVERY_ATTEMPTS_PER_TOOL = 3;
function sse(res, payload) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function parseToolArgs(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch {
    throw new Error('The model returned malformed JSON for a tool call.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Tool arguments must be a JSON object.');
  return parsed;
}
function systemPrompt(user) {
  return buildSystemPrompt(user);
}
async function requestRound({ messages, tools, toolChoice = 'auto', thinkingEnabled, signal, res, round, hasVision }) {
  log.debug('NVIDIA request round', { round, toolCount: tools.length, hasVision });
  const body = {
    model: MODEL_ID,
    messages,
    temperature: hasVision ? 0.6 : 1.0,
    top_p: 0.95,
    stream: true,
    chat_template_kwargs: { enable_thinking: Boolean(thinkingEnabled) },
    ...(tools.length ? { tools, tool_choice: toolChoice, parallel_tool_calls: toolChoice === 'auto' } : {}),
  };
  const response = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 9000);
    throw Object.assign(new Error(`NVIDIA NIM returned HTTP ${response.status}: ${detail}`), {
      status: response.status,
    });
  }
  if (!response.body) throw new Error('NVIDIA returned an empty streaming response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    content = '',
    finishReason = null,
    usage = null;
  const calls = new Map();
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const choice = data.choices?.[0],
      delta = choice?.delta || {};
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
    }
    // Deliberately discard provider reasoning fields. They are private model internals, not user-facing content.
    if (Array.isArray(delta.tool_calls))
      for (const item of delta.tool_calls) {
        const index = Number(item.index ?? 0),
          current = calls.get(index) || {
            index,
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
        if (item.id && !current.id) current.id = item.id;
        if (item.function?.name) current.function.name += item.function.name;
        if (item.function?.arguments) current.function.arguments += item.function.arguments;
        calls.set(index, current);
        sse(res, { type: 'tool_call_delta', round, index, name: current.function.name });
      }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (data.usage) usage = data.usage;
  };
  try {
    let done = false;
    while (!done) {
      const part = await reader.read();
      done = part.done;
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(handleLine);
    }
    if (buffer.trim()) handleLine(buffer);
  } finally {
    reader.releaseLock();
  }
  return {
    content,
    finishReason,
    usage,
    toolCalls: [...calls.values()].sort((a, b) => a.index - b.index),
  };
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
  log.info('Chat generation started', {
    userId,
    messageCount: body.messages.length,
    hasVision: body.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
    ),
  });
  const tools = getToolDefinitions();
  const requestIntent = classifyUserRequest(body.messages);
  const planTool = tools.find((tool) => tool.function?.name === 'create_task_plan');
  const pythonTool = tools.find((tool) => tool.function?.name === 'execute_python');
  const input = body.messages.map((m) => {
    const files = Array.isArray(m.attachments)
      ? m.attachments.filter((file) => file?.sandboxPath?.startsWith('uploads/'))
      : [];
    let content = m.content;
    if (files.length && m.role === 'user') {
      const fileContext = `User-provided files are available to execute_python in this conversation's sandbox workspace:\n${files.map((file) => `- ${file.name} (${file.type || 'file'}, ${Number(file.size) || 'unknown'} bytes): ${file.sandboxPath}`).join('\n')}\nUse these exact paths with Python pathlib/open; do not guess filenames. The execution service verifies each file's stored bytes and mounts it before running Python. If the execution tool reports a mount/integrity error, report that error rather than claiming the file is empty.`;
      content = Array.isArray(content)
        ? [{ type: 'text', text: fileContext }, ...content]
        : `${String(content || '')}\n\n${fileContext}`;
    }
    return {
      role: m.role,
      content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
    };
  });
  const messages = [{ role: 'system', content: systemPrompt(user) }, ...input];
  const hasVision = input.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
  );
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);
  const startedAt = Date.now();
  let finalUsage = null,
    finalText = '',
    rounds = 0,
    toolEvents = [];
  let planWasRequired = requestIntent.complex;
  let planExecutionAttempts = 0;
  let artifactExecutionAttempts = 0;
  let artifactExecutionForced = false;
  const agentState = { plan: null };
  const agentEvents = [];
  const consecutiveFailures = new Map();
  const emitAgentEvent = (eventType, data = {}) => {
    const event = {
      id: crypto.randomUUID(),
      type: eventType,
      at: new Date().toISOString(),
      ...data,
    };
    agentEvents.push(event);
    sse(res, { type: 'agent_event', event });
    return event;
  };
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      rounds = round + 1;
      sse(res, {
        type: 'status',
        status: round === 0 ? 'Thinking…' : 'Reviewing plugin results…',
        round,
      });
      let roundTools = tools;
      let toolChoice = 'auto';
      const forcedArtifactRound = artifactExecutionForced;
      const forcedPlanRound = planWasRequired && !agentState.plan && planExecutionAttempts < 2 && Boolean(planTool);
      if (forcedPlanRound) {
        planExecutionAttempts += 1;
        roundTools = [planTool];
        toolChoice = { type: 'function', function: { name: 'create_task_plan' } };
      } else if (artifactExecutionForced && pythonTool) {
        roundTools = [pythonTool];
        toolChoice = 'required';
      }
      const result = await requestRound({
        messages,
        tools: roundTools,
        toolChoice,
        thinkingEnabled: body.thinkingEnabled !== false,
        signal: controller.signal,
        res,
        round,
        hasVision,
      });
      finalUsage = result.usage || finalUsage;
      if (!result.toolCalls.length) {
        if (forcedPlanRound && !agentState.plan) {
          messages.push({ role: 'system', content: 'A visible execution plan is required for this substantial project. Call create_task_plan now with an ordered, concise plan. Do not replace the plan tool call with prose.' });
          emitAgentEvent('planning_required', { attempt: planExecutionAttempts, maxAttempts: 2 });
          continue;
        }
        const currentArtifacts = collectVerifiedArtifacts(toolEvents);
        const currentArtifactSatisfied = currentArtifacts.length > 0 && (!requestIntent.wantsZip || currentArtifacts.some((artifact) => artifact.name.toLowerCase().endsWith('.zip')));
        if (requestIntent.deliverable && !currentArtifactSatisfied && artifactExecutionAttempts < 2) {
          artifactExecutionForced = true;
          artifactExecutionAttempts += 1;
          messages.push({ role: 'system', content: `The user explicitly requested a real deliverable. The previous attempt did not produce the required verified artifact. Do not answer with code blocks or instructions. Use execute_python now. Inspect the existing workspace and fix or package the files already created rather than starting over unnecessarily. ${requestIntent.wantsZip ? 'Create a complete project directory and a ZIP archive at the workspace root. The ZIP must contain all source files and a README.' : 'Create the actual requested output file(s) in the workspace root.'} Use normal CPython, inspect the output, and do not claim completion until the tool returns saved artifact metadata.` });
          emitAgentEvent('execution_required', { message: 'A real file deliverable was requested; preparing workspace execution.' });
          continue;
        }
        if (requestIntent.deliverable && !currentArtifactSatisfied && artifactExecutionAttempts >= 2) {
          finalText = requestIntent.wantsZip
            ? 'I could not complete the requested ZIP deliverable. Two execution attempts did not produce a verified ZIP artifact. I will not claim that the project is ready; inspect the execution timeline for the actual errors.'
            : 'I could not complete the requested file deliverable. Two execution attempts did not produce a verified artifact. I will not claim that a file was created or downloaded; inspect the execution timeline for the actual errors.';
        } else {
          finalText = sanitizeAssistantText(result.content);
        }
        break;
      }
      if (round === MAX_TOOL_ROUNDS) throw new Error('Plugin execution exceeded the safety limit.');
      const calls = result.toolCalls.map((call, index) => ({
        id: call.id || `call_${round}_${index}`,
        type: 'function',
        function: { name: call.function.name, arguments: call.function.arguments || '{}' },
      }));
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: calls });
      for (const call of calls) {
        const name = call.function.name;
        let args = {};
        let argumentError = null;
        try { args = parseToolArgs(call.function.arguments); } catch (error) { argumentError = error.message; }
        const safeArgs =
          name === 'execute_python'
            ? {
                task_context: args.task_context || '',
                code_bytes: Buffer.byteLength(String(args.code || ''), 'utf8'),
              }
            : args;
        sse(res, { type: 'tool_start', name, arguments: safeArgs, round });
        emitAgentEvent('tool_started', { name, label: name.replaceAll('_', ' '), round });
        const previousFailures = consecutiveFailures.get(name) || 0;
        let outcome;
        if (argumentError) {
          outcome = { ok: false, error: argumentError };
        } else if (previousFailures >= MAX_RECOVERY_ATTEMPTS_PER_TOOL) {
          outcome = {
            ok: false,
            error: `Recovery limit reached for ${name}. Stop retrying this tool and explain the remaining limitation.`,
          };
        } else {
          outcome = await runTool(name, args, user, {
            signal: controller.signal,
            chatId: body.chatId,
            agentState,
            onAgentEvent: (eventType, data) => {
              if (eventType === 'plan_created' && data.plan) agentState.plan = data.plan;
              emitAgentEvent(eventType, data);
            },
          });
        }
        const toolCompleted =
          outcome.ok &&
          (name !== 'execute_python' || outcome.result?.status === 'completed') &&
          (name !== 'generate_image' || outcome.result?.status === 'completed');
        if (toolCompleted) consecutiveFailures.delete(name);
        else consecutiveFailures.set(name, previousFailures + 1);
        const errorText = outcome.ok
          ? name === 'execute_python' && outcome.result?.status !== 'completed'
            ? outcome.result?.stderr || `Python execution ${outcome.result?.status || 'failed'}.`
            : name === 'generate_image' && outcome.result?.status !== 'completed'
              ? outcome.result?.error || 'Image generation did not complete.'
              : undefined
          : outcome.error;
        const eventResult = outcome.ok && outcome.result ? { ...outcome.result } : undefined;
        if (Array.isArray(eventResult?.artifacts)) eventResult.artifacts = eventResult.artifacts.map(({ downloadUrl, ...artifact }) => artifact);
        const event = {
          name,
          arguments: safeArgs,
          status: toolCompleted ? 'complete' : 'error',
          result: eventResult,
          error: errorText,
          attempt: previousFailures + 1,
        };
        toolEvents.push(event);
        if (!toolCompleted) {
          emitAgentEvent('self_correction', {
            tool: name,
            attempt: previousFailures + 1,
            maxAttempts: MAX_RECOVERY_ATTEMPTS_PER_TOOL,
            status:
              previousFailures + 1 >= MAX_RECOVERY_ATTEMPTS_PER_TOOL ? 'blocked' : 'diagnosing',
            error: String(errorText || 'Tool did not complete.').slice(0, 1200),
            message:
              previousFailures + 1 >= MAX_RECOVERY_ATTEMPTS_PER_TOOL
                ? 'Retry limit reached. Reassess the approach.'
                : 'A tool failed. Inspect the error, correct the cause, then retry only if the operation is recoverable.',
          });
        } else {
          emitAgentEvent('tool_completed', {
            name,
            label: name.replaceAll('_', ' '),
            attempt: previousFailures + 1,
          });
        }
        sse(res, { type: 'tool_result', ...event, round });
        const modelResult = eventResult;
        const toolPayload = {
          ...outcome,
          ...(outcome.ok ? { result: modelResult } : {}),
          ...(!toolCompleted
            ? {
                recoveryGuidance:
                  previousFailures + 1 >= MAX_RECOVERY_ATTEMPTS_PER_TOOL
                    ? 'The retry limit has been reached. Do not call this tool again in this turn. Explain the failure and offer a different approach.'
                    : 'Self-correction required: inspect the actual error, identify the cause, change the arguments or implementation, then retry at most within the remaining attempt budget. Never repeat the same failing call unchanged.',
              }
            : {}),
        };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: JSON.stringify(toolPayload),
        });
      }
      if (forcedArtifactRound) artifactExecutionForced = false;
    }
    const verifiedArtifacts = collectVerifiedArtifacts(toolEvents);
    const zipVerified = verifiedArtifacts.some((artifact) => artifact.name.toLowerCase().endsWith('.zip'));
    const artifactSatisfied = !requestIntent.deliverable || (verifiedArtifacts.length > 0 && (!requestIntent.wantsZip || zipVerified));
    if (requestIntent.deliverable && !artifactSatisfied) {
      finalText = requestIntent.wantsZip
        ? 'I could not complete the requested ZIP deliverable. No verified ZIP artifact was produced, so I will not claim that the project is ready. Check the execution timeline for the actual tool result and error.'
        : 'I could not complete the requested file deliverable. No verified output artifact was produced, so I will not claim that a file was created or downloaded. Check the execution timeline for the actual tool result and error.';
    } else {
      finalText = sanitizeAssistantText(finalText);
      if (requestIntent.deliverable && verifiedArtifacts.length) {
        const delivered = verifiedArtifacts.filter((artifact) => !requestIntent.wantsZip || artifact.name.toLowerCase().endsWith('.zip'));
        finalText = `${finalText}${finalText ? '\n\n' : ''}Verified deliverable${delivered.length === 1 ? '' : 's'}: ${delivered.map((artifact) => `${artifact.name} (${artifact.size.toLocaleString()} bytes)`).join(', ')}. The actual file${delivered.length === 1 ? ' is' : 's are'} available in the File Library below.`;
      }
      if (planWasRequired && !agentState.plan) finalText = `${finalText}${finalText ? '\n\n' : ''}Note: the required execution plan could not be created, so the planning stage remains incomplete.`;
    }
    for (const part of finalText.match(/[^]{1,1200}/g) || []) sse(res, { type: 'chunk', round: rounds - 1, content: part });
    const visible = body.messages.filter((m) => m.role !== 'system' && m.role !== 'tool');
    if (agentEvents.length || agentState.plan) {
      const hasFailed = agentState.plan?.tasks.some((task) => task.status === 'failed');
      const allDone = agentState.plan
        ? agentState.plan.tasks.every((task) => ['completed', 'skipped'].includes(task.status))
        : !planWasRequired;
      emitAgentEvent('agent_completed', {
        status: hasFailed ? 'failed' : allDone ? 'completed' : 'incomplete',
        message: hasFailed ? 'Some planned tasks failed.' : allDone ? 'The planned work is complete.' : planWasRequired && !agentState.plan ? 'The required execution plan was not created.' : 'The response finished with planned tasks still pending.',
      });
    }
    await persist?.([
      ...visible,
      {
        id: String(body.assistantMessageId || crypto.randomUUID()),
        role: 'assistant',
        content: finalText,
        usage: finalUsage,
        toolEvents,
        agentPlan: agentState.plan,
        agentEvents,
        createdAt: new Date().toISOString(),
      },
    ]);
    log.info('Chat generation completed', {
      userId,
      rounds,
      durationMs: Date.now() - startedAt,
      toolEventCount: toolEvents.length,
      verifiedArtifactCount: verifiedArtifacts.length,
      deliverableSatisfied: artifactSatisfied,
      usage: finalUsage,
    });
    sse(res, {
      type: 'done',
      usage: finalUsage,
      durationMs: Date.now() - startedAt,
      toolRounds: rounds,
      agentPlan: agentState.plan,
      agentEvents,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      log.warn('Chat generation aborted by client', { userId });
      sse(res, { type: 'stopped' });
    } else {
      log.error('Chat generation failed', {
        userId,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack, status: error.status }
            : String(error),
      });
      sse(res, {
        type: 'error',
        status: error.status || 502,
        error: error.message || 'NVIDIA request failed.',
      });
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}
export async function generateChatTitle(text) {
  const response = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_ID,
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
