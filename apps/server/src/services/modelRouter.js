import { MODEL_REGISTRY, DEFAULT_MODEL_ALIAS, getModel } from './modelRegistry.js';

const ROUTER_SYSTEM = `You are a task router for Nemotron Agent Lab. Choose exactly one model alias from bolt, vision, surge, titan, omni. Return only JSON: {"model":"alias","task_type":"short label","complexity":"low|medium|high","reason":"brief reason","confidence":0.0}. Choose bolt only for simple, self-contained text tasks that need no tools, browsing, research, current information, code execution, or workspace changes; surge for ordinary coding, multi-step tool use, web research and long-running agents; titan for unusually complex architecture, difficult debugging, high-stakes analysis or very long-context reasoning; vision for image/video inputs requiring visual understanding; omni for audio/video/speech-heavy multimodal tasks. Do not choose titan just because a request is long. Prefer surge when uncertain. Never invent capabilities.`;

function latestUserMessage(messages = []) {
  return [...messages].reverse().find((message) => message.role === 'user') || {};
}

function messageText(message = {}) {
  const content = Array.isArray(message.content)
    ? contentText(message.content)
    : String(message.content || '');
  return content;
}

function contentText(parts = []) {
  return parts.filter((part) => part?.type === 'text').map((part) => part.text || '').join(' ');
}


function isContextualFollowUp(message = {}) {
  const text = messageText(message).trim();
  if (!text || text.length > 320) return false;
  return /\b(it|this|that|these|those|same|above|previous|earlier|the file|the result|the output|the code|the project|next step|continue|proceed|retry|try again|yes|sure|please|do it|go ahead|sounds good|also|now|check|test|run|open|download|modify|update|fix|improve|explain|verify|validate)\b/i.test(text);
}

export function previousTurnModel(messages = []) {
  const latestUserIndex = messages.map((message) => message.role).lastIndexOf('user');
  if (latestUserIndex < 0) return null;
  const latestUser = messages[latestUserIndex];
  if (!isContextualFollowUp(latestUser)) return null;
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const alias = String(message.model?.alias || message.modelAlias || message.model?.modelAlias || '').toLowerCase();
    return MODEL_REGISTRY[alias] ? alias : null;
  }
  return null;
}

function routingContextText(messages = []) {
  const userMessages = messages.filter((message) => message.role === 'user').slice(-6);
  if (!userMessages.length) return '';
  const latest = messageText(userMessages[userMessages.length - 1]);
  const isShortFollowUp = latest.length <= 100 && /\b(retry|try again|continue|proceed|go ahead|use tools|search on web|look it up|do it|that|this|it)\b/i.test(latest);
  const selected = isShortFollowUp ? userMessages.slice(-4) : [userMessages[userMessages.length - 1]];
  return selected.map((message, index) => `User turn ${index + 1}: ${messageText(message)}`).join('\n').slice(-7000);
}

export function requiresAgentExecution(text = '') {
  return /\b(build|implement|debug|refactor|research|deploy|test|modify|fix|write files|repository|codebase|project|run tests|execute code|install dependencies|compile|review code|audit code|inspect code|analyze code|analyse code|use tools|search (?:the )?web|search on (?:the )?web|web search|search online|look up|browse|fetch|open (?:the )?url|visit (?:the )?website|check online|latest|current version|up[- ]to[- ]date|recent release|today)\b/i.test(text)
    || /\b(create|write|generate|save)\s+(?:a|an|the)?\s*(?:(?:python|javascript|typescript|node(?:\.js)?|react)?\s*)?(?:file|folder|project|app|application|website|repo|repository|component|module|package|script|code|document|spreadsheet|presentation|image|picture|illustration|diagram|logo|icon)\b/i.test(text)
    || /\bsave\s+(?:it|this|the result|the output)\s+(?:as|to)\s+(?:a\s+)?file\b/i.test(text)
    || (/\b(create|make|generate)\s+(?:one|it)\b/i.test(text) && /\b(html|file|script|document|website|app|project)\b/i.test(text));
}

export function requiresToolCapableModel(messages = []) {
  return requiresAgentExecution(routingContextText(messages));
}

export function isEmptyModelResponse(result = {}) {
  return !String(result.content || '').trim() && !(Array.isArray(result.toolCalls) && result.toolCalls.length);
}

export function ruleBasedRoute(messages = []) {
  const latest = latestUserMessage(messages);
  const content = Array.isArray(latest.content) ? latest.content : [];
  if (content.some((part) => part?.type === 'audio_url' || part?.type === 'input_audio')) return { alias: 'omni', taskType: 'audio_understanding', complexity: 'medium', reason: 'The request contains audio input and requires an audio-capable model.', confidence: 0.99, source: 'capability-rule' };
  if (content.some((part) => part?.type === 'image_url')) return { alias: 'vision', taskType: 'visual_understanding', complexity: 'medium', reason: 'The request contains image or extracted video-frame input.', confidence: 0.98, source: 'capability-rule' };
  const text = routingContextText(messages).toLowerCase();
  if (/\b(audio|voice recording|speech|transcribe|transcription|sound file)\b/.test(text)) return { alias: 'omni', taskType: 'audio_multimodal', complexity: 'medium', reason: 'The request explicitly requires audio or speech understanding.', confidence: 0.88, source: 'capability-rule' };
  if (/\b(entire|complete|production[- ]ready|large codebase|architecture|distributed system|security audit|complex debugging|root cause)\b/.test(text) && text.length > 500) return { alias: 'titan', taskType: 'complex_engineering', complexity: 'high', reason: 'The request signals a complex engineering or analysis task.', confidence: 0.68, source: 'capability-rule' };
  if (requiresAgentExecution(text)) return { alias: 'surge', taskType: 'agent_or_research_task', complexity: 'medium', reason: 'The request requires current information, research, tools, code execution or workspace actions; Bolt cannot perform those operations.', confidence: 0.9, source: 'capability-rule' };
  if (text.length < 260) return { alias: 'bolt', taskType: 'simple_text', complexity: 'low', reason: 'A short, self-contained text request is best handled by a lightweight model.', confidence: 0.7, source: 'capability-rule' };
  return { alias: 'surge', taskType: 'general_agent_task', complexity: 'medium', reason: 'The general-purpose agent model is the balanced default.', confidence: 0.65, source: 'capability-rule' };
}

export async function routeModel({ messages, apiKey, signal }) {
  const fallback = ruleBasedRoute(messages);
  const continuationAlias = previousTurnModel(messages);
  // Preserve the model that performed the previous turn for contextual follow-ups.
  if (continuationAlias && continuationAlias !== 'bolt') {
    const previousModel = getModel(continuationAlias);
    const latest = latestUserMessage(messages);
    const latestContent = Array.isArray(latest.content) ? latest.content : [];
    const hasImage = latestContent.some((part) => part?.type === 'image_url');
    const hasAudio = latestContent.some((part) => part?.type === 'audio_url' || part?.type === 'input_audio');
    if ((!hasImage || previousModel.supportsVision) && (!hasAudio || previousModel.supportsAudio)) {
      return {
        alias: continuationAlias,
        taskType: 'conversation_continuation',
        complexity: 'medium',
        reason: `Continuing the previous turn with ${previousModel.name}; the latest message refers to the existing task or its output.`,
        confidence: 0.94,
        source: 'conversation-continuity',
      };
    }
  }
  if (!apiKey) return fallback;
  const latest = latestUserMessage(messages);
  const context = routingContextText(messages);
  const payload = {
    model: MODEL_REGISTRY.bolt.id,
    messages: [
      { role: 'system', content: ROUTER_SYSTEM },
      { role: 'user', content: `Classify the current task using recent user-turn context. Has image input: ${Array.isArray(latest.content) && latest.content.some((p) => p.type === 'image_url')}. Has audio input: ${Array.isArray(latest.content) && latest.content.some((p) => p.type === 'audio_url' || p.type === 'input_audio')}. Recent user context:\n${context.slice(0, 6500)}` },
    ],
    temperature: 0.1, max_tokens: 180, stream: false,
    response_format: { type: 'json_object' },
    chat_template_kwargs: { enable_thinking: false },
  };
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: signal || AbortSignal.timeout(12000) });
    if (!response.ok) return { ...fallback, routerCalled: true };
    const data = await response.json();
    const raw = String(data.choices?.[0]?.message?.content || '').replace(/^```(?:json)?|```$/g, '').trim();
    const parsed = JSON.parse(raw);
    const alias = String(parsed.model || '').toLowerCase();
    if (!MODEL_REGISTRY[alias]) return { ...fallback, routerCalled: true, usage: data.usage || null };
    const model = getModel(alias);
    if (Array.isArray(latest.content) && latest.content.some((p) => p.type === 'audio_url' || p.type === 'input_audio') && !model.supportsAudio) return { ...fallback, alias: 'omni', taskType: 'audio_understanding', complexity: 'medium', reason: 'Audio input requires the Omni model.', confidence: 1, source: 'capability-guard', routerCalled: true, usage: data.usage || null };
    if (Array.isArray(latest.content) && latest.content.some((p) => p.type === 'image_url') && !model.supportsVision) return { ...fallback, routerCalled: true, usage: data.usage || null };
    if (alias === 'bolt' && requiresAgentExecution(context)) {
      return { ...fallback, alias: 'surge', taskType: 'agent_execution_or_research', complexity: 'medium', reason: 'The current task or its recent follow-up requires tools, browsing, current information or workspace actions; routed to a tool-capable model.', confidence: 0.92, source: 'capability-guard', routerCalled: true, usage: data.usage || null };
    }
    return { alias, routerCalled: true, taskType: String(parsed.task_type || 'general').slice(0, 60), complexity: ['low','medium','high'].includes(parsed.complexity) ? parsed.complexity : 'medium', reason: String(parsed.reason || fallback.reason).slice(0, 240), confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)), source: 'ai-router', usage: data.usage || null };
  } catch { return { ...fallback, routerCalled: true }; }
}

export function escalationTarget(alias) {
  if (alias === 'bolt') return 'surge';
  if (alias === 'surge') return 'titan';
  if (alias === 'vision') return 'omni';
  if (alias === 'omni' || alias === 'titan') return null;
  return DEFAULT_MODEL_ALIAS;
}

export function isEscalatableModelError(error) {
  const status = Number(error?.status || 0);
  const code = error?.code || error?.cause?.code;
  const contextLimit = status === 400 && /context (?:length|window)|too many tokens|maximum (?:input )?tokens|prompt is too long/i.test(String(error?.message || ''));
  return contextLimit || status === 408 || status === 409 || status === 413 || status === 429 || status >= 500 || ['MODEL_STREAM_IDLE_TIMEOUT', 'MODEL_ROUND_TIMEOUT', 'MODEL_EMPTY_RESPONSE', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || error?.name === 'TypeError';
}
