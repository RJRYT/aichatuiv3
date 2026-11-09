import crypto from 'node:crypto';
import { getToolDefinitions, runTool } from './tools.js';
import { buildSystemPrompt } from './systemPrompt.js';
import logger from '../utils/logger.js';
import { getArtifact } from './interpreter/artifactStore.js';
import { detectDeliverableContract, inspectZipBuffer, assessWebsiteQuality } from './deliverablePolicy.js';

export const MODEL_ID = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const log = logger.child({ component: 'nvidia' });
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_TOOL_ROUNDS = 24;
const MAX_RECOVERY_ATTEMPTS_PER_TOOL = 3;

const FILE_ACTION_PROMPT = `This request requires a real file operation. Use the required execution tool, perform the requested action, save the resulting file into the current workspace, and verify the stored artifact. Do not provide a script for the user to run instead of doing the operation. Do not claim success without a real, non-empty artifact.`;
const IMAGE_DELIVERABLE_PROMPT = `The user requested an original image. Use the required image-generation tool, inspect its actual result, and only report success if the image artifact is stored and verified. Do not provide a prompt or instructions as a substitute for generating the image.`;

const DELIVERABLE_PROMPT = `You are producing a real, user-facing deliverable, not a tutorial.
Treat the user's request as a product brief. Before implementation, define the actual requirements,
feature scope, information architecture, visual direction, responsive behavior, accessibility,
error/empty/loading states, data model, and acceptance criteria appropriate to the requested product.
Create a detailed implementation plan (normally 5–8 meaningful tasks). Do not use vague tasks such as
"write files". Plan design, implementation, quality assurance, packaging, and verification separately.

Implementation quality is a priority. Do not rush or minimize the source to save tokens. Generate
complete, cohesive, maintainable files with production-minded structure, thoughtful UX, polished visual
design, responsive layouts, semantic markup, accessible controls, validation, empty states, useful
feedback, and robust edge-case handling. Use the same implementation depth you would provide in a
high-quality direct code answer. Do not replace implementation with snippets, pseudocode, TODOs,
placeholders, or instructions for the user to finish.

Use execute_python to create the actual files in the workspace. Write all requested source files and
documentation. Run appropriate static/functional checks and fix failures. If an archive is requested,
create it only after the project files and checks are complete. Reopen the archive, inspect its entries,
and verify it is readable and non-empty. Return concise execution evidence in stdout. Do not claim
browser testing unless a browser test actually ran. Do not claim production readiness without evidence.
The backend independently checks the requested artifact before accepting completion.`;



async function verifyDeliverableArtifacts(result, userId, contract) {
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  const verified = [];
  const fileContents = new Map();
  for (const metadata of artifacts) {
    if (!metadata?.id || !Number(metadata.size)) continue;
    const stored = await getArtifact(metadata.id, userId);
    if (!stored || !Buffer.isBuffer(stored.data) || stored.data.length !== Number(metadata.size)) continue;
    if (metadata.sha256 && stored.sha256 !== metadata.sha256) continue;
    fileContents.set(String(metadata.name || ''), stored.data);
    const item = { id: metadata.id, name: metadata.name, size: stored.data.length, mimeType: stored.mimeType };
    if (/\.zip$/i.test(String(metadata.name || '')) || stored.mimeType === 'application/zip') {
      const zip = inspectZipBuffer(stored.data);
      if (zip.valid) item.zip = zip;
    }
    verified.push(item);
  }
  const archive = verified.find((item) => item.zip);
  const websiteFiles = archive?.zip?.entries || [...fileContents.entries()].map(([name, content]) => ({ name, content, uncompressedSize: content.length }));
  const websiteQuality = contract.website ? assessWebsiteQuality(websiteFiles) : { passed: true, checks: {} };
  const qualityChecks = websiteQuality.checks;
  const qualityPassed = websiteQuality.passed;
  const valid = contract.archiveRequired
    ? Boolean(archive && (!contract.website || qualityPassed))
    : contract.website
      ? Boolean(html && css && js && qualityPassed)
      : verified.length > 0;
  return {
    valid,
    verified,
    archive: archive || null,
    qualityChecks,
    reason: !valid
      ? contract.archiveRequired
        ? contract.website
          ? `Website ZIP failed quality checks: ${Object.entries(qualityChecks).filter(([, passed]) => !passed).map(([name]) => name).join(', ') || 'required HTML/CSS/JS files missing'}.`
          : 'A valid, non-empty ZIP archive has not been generated and verified.'
        : 'No generated artifact has been stored and verified.'
      : '',
  };
}
function sse(res, payload) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function stripInternalArtifactUrls(value) {
  if (Array.isArray(value)) return value.map(stripInternalArtifactUrls);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'downloadUrl' && typeof item === 'string' && item.startsWith('/api/interpreter/artifacts/')) {
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
function systemPrompt(user) {
  return buildSystemPrompt(user);
}
async function requestRound({ messages, tools, thinkingEnabled, signal, res, round, hasVision, requiredToolName, isDeliverable }) {
  log.debug('NVIDIA request round', { round, toolCount: tools.length, hasVision });
  const body = {
    model: MODEL_ID,
    messages,
    temperature: isDeliverable ? 0.35 : hasVision ? 0.6 : 1.0,
    top_p: isDeliverable ? 0.9 : 0.95,
    max_tokens: 8192,
    stream: true,
    chat_template_kwargs: { enable_thinking: Boolean(thinkingEnabled) },
    ...(tools.length
      ? {
          tools,
          tool_choice: requiredToolName
            ? { type: 'function', function: { name: requiredToolName } }
            : 'auto',
          parallel_tool_calls: !requiredToolName,
        }
      : {}),
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
      sse(res, { type: 'chunk', round, content: delta.content });
    }
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
  const deliverableContract = detectDeliverableContract(body.messages);
  const messages = [
    { role: 'system', content: systemPrompt(user) },
    ...(deliverableContract
      ? [{
          role: 'system',
          content: `${deliverableContract.executionTool === 'generate_image' ? IMAGE_DELIVERABLE_PROMPT : deliverableContract.requiresPlan ? DELIVERABLE_PROMPT : FILE_ACTION_PROMPT}\n\nDELIVERABLE CONTRACT:\n- Archive required: ${deliverableContract.archiveRequired ? 'yes' : 'no'}\n- Website project: ${deliverableContract.website ? 'yes' : 'no'}\n- User request: ${deliverableContract.userRequest}`,
        }]
      : []),
    ...input,
  ];
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
  const agentState = { plan: null, deliverableContract, deliverableVerification: null, pythonArtifactRuns: 0 };
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
      const planTasks = agentState.plan?.tasks || [];
      const planHasRunningTask = planTasks.some((task) => task.status === 'running');
      const planIsComplete =
        planTasks.length > 0 &&
        planTasks.every((task) => ['completed', 'skipped'].includes(task.status));
      const requiredToolName = deliverableContract
        ? deliverableContract.requiresPlan
          ? !agentState.plan
            ? 'create_task_plan'
            : !agentState.deliverableVerification?.valid
              ? planHasRunningTask
                ? deliverableContract.executionTool
                : 'update_task_status'
              : !planIsComplete
                ? 'update_task_status'
                : null
          : !agentState.deliverableVerification?.valid
            ? deliverableContract.executionTool
            : null
        : null;
      const result = await requestRound({
        messages,
        tools,
        requiredToolName,
        isDeliverable: Boolean(deliverableContract),
        thinkingEnabled: body.thinkingEnabled !== false,
        signal: controller.signal,
        res,
        round,
        hasVision,
      });
      finalUsage = result.usage || finalUsage;
      finalText += result.content;
      if (!result.toolCalls.length) {
        if (requiredToolName) {
          throw new Error(`The agent did not invoke the required ${requiredToolName} operation. The requested deliverable cannot be marked complete.`);
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
        const args = parseToolArgs(call.function.arguments);
        if (requiredToolName && name !== requiredToolName) {
          throw new Error(`The model selected ${name} when ${requiredToolName} was required for the deliverable workflow.`);
        }
        const safeArgs =
          name === 'execute_python'
            ? { task_context: args.task_context || '', code_bytes: Buffer.byteLength(String(args.code || ''), 'utf8') }
            : args;
        sse(res, { type: 'tool_start', name, arguments: safeArgs, round });
        emitAgentEvent('tool_started', { name, label: name.replaceAll('_', ' '), round });
        const previousFailures = consecutiveFailures.get(name) || 0;
        let outcome;
        if (previousFailures >= MAX_RECOVERY_ATTEMPTS_PER_TOOL) {
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
        if (deliverableContract && name === deliverableContract.executionTool && outcome.ok && outcome.result?.status === 'completed') {
          agentState.pythonArtifactRuns += 1;
          try {
            agentState.deliverableVerification = await verifyDeliverableArtifacts(
              outcome.result,
              userId,
              deliverableContract
            );
          } catch (verificationError) {
            agentState.deliverableVerification = {
              valid: false,
              verified: [],
              reason: `Artifact verification failed: ${verificationError.message}`,
            };
          }
          emitAgentEvent('deliverable_validation', {
            status: agentState.deliverableVerification.valid ? 'verified' : 'incomplete',
            verifiedCount: agentState.deliverableVerification.verified.length,
            message: agentState.deliverableVerification.valid
              ? 'Requested deliverable was found in storage and independently verified.'
              : agentState.deliverableVerification.reason,
          });
        }
        if (toolCompleted) consecutiveFailures.delete(name);
        else consecutiveFailures.set(name, previousFailures + 1);
        const errorText = outcome.ok
          ? name === 'execute_python' && outcome.result?.status !== 'completed'
            ? outcome.result?.stderr || `Python execution ${outcome.result?.status || 'failed'}.`
            : name === 'generate_image' && outcome.result?.status !== 'completed'
              ? outcome.result?.error || 'Image generation did not complete.'
              : undefined
          : outcome.error;
        const safeOutcome = stripInternalArtifactUrls(outcome);
        const event = {
          name,
          arguments: safeArgs,
          status: toolCompleted ? 'complete' : 'error',
          result: safeOutcome.ok ? safeOutcome.result : undefined,
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
        const toolPayload = {
          ...safeOutcome,
          ...(deliverableContract && name === deliverableContract.executionTool
            ? { deliverableValidation: agentState.deliverableVerification }
            : {}),
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
        if (!toolCompleted && previousFailures >= MAX_RECOVERY_ATTEMPTS_PER_TOOL) {
          throw new Error(`Recovery limit reached for ${name}. The requested operation could not be completed safely.`);
        }
        if (
          deliverableContract &&
          name === deliverableContract.executionTool &&
          agentState.deliverableVerification &&
          !agentState.deliverableVerification.valid &&
          agentState.pythonArtifactRuns >= MAX_RECOVERY_ATTEMPTS_PER_TOOL
        ) {
          throw new Error(`Deliverable validation failed after ${MAX_RECOVERY_ATTEMPTS_PER_TOOL} completed generation attempts: ${agentState.deliverableVerification.reason}`);
        }
      }
    }
    if (deliverableContract && !agentState.deliverableVerification?.valid) {
      throw new Error(
        `Deliverable completion blocked: ${agentState.deliverableVerification?.reason || 'the requested files have not been generated and verified'}`
      );
    }
    if (
      deliverableContract?.requiresPlan &&
      (!agentState.plan?.tasks?.length ||
        !agentState.plan.tasks.every((task) => ['completed', 'skipped'].includes(task.status)))
    ) {
      throw new Error('Deliverable completion blocked: the execution plan still contains unfinished tasks.');
    }
    const visible = body.messages.filter((m) => m.role !== 'system' && m.role !== 'tool');
    if (deliverableContract && !finalText.trim()) {
      const names = agentState.deliverableVerification.verified.map((item) => item.name).filter(Boolean);
      finalText = `The requested deliverable was generated and verified. Available file${names.length === 1 ? '' : 's'}: ${names.join(', ')}. Use the generated-file controls in this conversation to access them.`;
    }
    finalText = finalText.replace(/\/?api\/interpreter\/artifacts\/[a-zA-Z0-9_-]+/g, '[use the generated-file controls in this conversation]');
    if (agentEvents.length || agentState.plan) {
      const allDone =
        !agentState.plan ||
        agentState.plan.tasks.every((task) => ['completed', 'skipped'].includes(task.status));
      emitAgentEvent('agent_completed', {
        status: allDone ? 'completed' : 'finished_with_pending_tasks',
        message: allDone
          ? 'The planned work is complete.'
          : 'The response finished with some planned tasks still pending.',
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
      usage: finalUsage,
    });
    sse(res, {
      type: 'done',
      usage: finalUsage,
      durationMs: Date.now() - startedAt,
      toolRounds: rounds,
      agentPlan: agentState.plan,
      agentEvents,
      deliverableVerification: agentState.deliverableVerification,
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
