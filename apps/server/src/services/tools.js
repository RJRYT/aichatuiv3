import { executePython } from './interpreter/interpreter.js';
import { getInterpreterStatus } from './interpreter/sandboxManager.js';
import { getChat } from './chatStore.js';
import { Parser } from 'expr-eval';
import { User } from '../models/User.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import logger from '../utils/logger.js';
import { generateImageArtifact, getImageGenerationStatus } from './imageGeneration.js';
import { createTaskPlan, updatePlannedTask } from './agentPlanning.js';

const log = logger.child({ component: 'tools' });
const parser = new Parser({
  operators: { logical: false, comparison: false, in: false, assignment: false },
});

const tools = [
  {
    type: 'function',
    function: {
      name: 'report_progress',
      description: 'Send a concise user-facing progress update while working. Use this at meaningful milestones, especially before a lengthy operation and after completing a significant step. Write one natural sentence in first person describing the action you are actually taking or a verified finding. This is NOT a place for private chain-of-thought, hidden reasoning, speculative plans, generic filler, or a list of internal thoughts. Examples of style: “I found the relevant files and am checking how the upload flow works.” or “The implementation is in place; I’m running the focused tests now.”',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', minLength: 8, maxLength: 280, description: 'One concise, user-safe sentence about the current action or verified progress.' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_python',
      description:
        'Execute full CPython 3.14 code in an isolated Vercel Firecracker microVM. For a requested website, application, project, script, or other concrete deliverable, this is the required implementation environment: generate complete, high-quality source files (not snippets), documentation, tests or validation scripts, and any requested archive. Treat the request as a product brief; implement a polished, complete result rather than a minimal demo. Use a cohesive file structure, responsive and accessible UI where applicable, robust validation, error/empty states, and thoughtful interaction design. Run checks, fix failures, and create/inspect the requested ZIP. Never substitute instructions or code snippets in chat for actual files. Use for calculations, data analysis, automation, document creation, image processing, charts, and general Python tasks. The sandbox has a persistent private workspace for this conversation, supports pip installs and normal filesystem operations, and has public network access with private/reserved IP ranges blocked. Supported uploaded images and documents for this conversation are mounted under uploads/; video attachments are provided as sampled frames to the vision model. Write generated files into the current working directory outside uploads/; the backend automatically collects supported files into the user File Library. Common missing libraries (including matplotlib, numpy, pandas, scipy, Pillow, openpyxl, reportlab, python-docx and python-pptx) are detected and installed automatically before execution; for other packages, install them with subprocess.run([sys.executable, "-m", "pip", "install", "package"], check=True). If an OS-level dependency is unavailable, report the limitation rather than assuming privileged package installation is available. Never read host secrets or environment variables, attempt sandbox escape, or target private/internal networks. Treat uploaded files as private and do not transmit them externally unless the user explicitly requests it. Inspect stdout, stderr, exitCode, status and artifact metadata. Do not claim success unless status is completed.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'Complete Python 3.14 source code. For project requests, include all source content and generation logic in this call; create the full project and run real checks. Avoid placeholders, TODOs, pseudocode, abbreviated files, and toy implementations. Use normal CPython, filesystem APIs and installed third-party libraries. Write output files into the current working directory so they are saved to the File Library. Common missing dependencies are auto-installed before execution; install any unrecognized package with subprocess.run([sys.executable, "-m", "pip", "install", "package"], check=True). Keep output concise.',
          },
          task_context: {
            type: 'string',
            description: 'Brief description of the intended computation.',
          },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task_plan',
      description:
        'Create a visible execution plan for a complex multi-step user request. Use this before beginning tasks that require multiple distinct steps or tools. Provide a concise objective and ordered tasks with stable IDs and dependencies. This creates a user-visible plan; it does not execute tasks by itself.',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string', minLength: 1, maxLength: 500 },
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 32 },
                title: { type: 'string', minLength: 1, maxLength: 100 },
                description: { type: 'string', maxLength: 300 },
                depends_on: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['objective', 'tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description:
        'Update a task in the active visible plan. Mark a task running before work, completed only after verifying its result, failed when blocked, or skipped when no longer needed. Dependencies must be completed before a task can start.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
          },
          note: { type: 'string', maxLength: 500 },
        },
        required: ['task_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate one or two original images from a text prompt and save them to the user File Library. Use when the user requests image creation or when an image is a clearly useful deliverable in an explicitly requested creative task. This is a real image-generation API call and consumes the configured account quota. Do not use for image editing of uploaded images.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 2048 },
          steps: { type: 'integer', minimum: 1, maximum: 8 },
          count: { type: 'integer', minimum: 1, maximum: 2 },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web for current information. Return concise source titles, URLs, snippets and dates. Use for current facts, research, documentation and news.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Specific search query' },
          topic: {
            type: 'string',
            enum: ['general', 'news', 'finance'],
            description: 'Search topic',
          },
          max_results: { type: 'integer', minimum: 1, maximum: 8 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Save a concise, durable, non-sensitive fact or preference about the user to long-term memory. Use proactively when the user shares stable preferences, ongoing projects, technical stack, goals, or recurring workflow context that would materially improve future answers; also honor explicit remember/save requests. Do not save transient details, secrets, credentials, financial account data, or sensitive personal/medical/legal/identity information. Avoid duplicates and phrase memories as neutral facts.',
      parameters: {
        type: 'object',
        properties: {
          memory: { type: 'string', description: 'A concise user fact or preference to remember' },
        },
        required: ['memory'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memories',
      description: "Search the current user's saved memories for relevant information.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculator',
      description:
        'Evaluate a mathematical expression using arithmetic operators and common math functions.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: 'Get the current date and time in an IANA timezone.',
      parameters: { type: 'object', properties: { timezone: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'npm_search',
      description: 'Search npm packages by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_search',
      description: 'Search public GitHub repositories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_public_url',
      description:
        'Fetch and extract text from a public HTTPS webpage or documentation URL. Do not access private network addresses.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
];

function isPrivateAddress(address) {
  const value = address.toLowerCase().split('%')[0];
  if (isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      parts[0] >= 224 ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  if (isIP(value) === 6) {
    if (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/.test(value)
    )
      return true;
    if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  }
  return isIP(value) === 0;
}
async function safeUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Only public HTTPS URLs are allowed.');
  let addresses;
  if (isIP(url.hostname)) addresses = [{ address: url.hostname }];
  else addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address)))
    throw new Error(
      'The URL resolves to a private or non-public network address and cannot be fetched.'
    );
  return url;
}
async function tavilySearch(args) {
  if (!process.env.TAVILY_API_KEY)
    throw new Error('Web search is not configured. Add TAVILY_API_KEY to the backend environment.');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: String(args.query || '').slice(0, 500),
      topic: ['general', 'news', 'finance'].includes(args.topic) ? args.topic : 'general',
      search_depth: 'basic',
      max_results: Math.max(1, Math.min(8, Number(args.max_results) || 5)),
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `Tavily returned HTTP ${response.status}`);
  return {
    query: args.query,
    answer: data.answer || null,
    results: (data.results || []).map((item) => ({
      title: item.title,
      url: item.url,
      content: item.content,
      score: item.score,
      published_date: item.published_date || null,
    })),
  };
}
async function executeTool(name, args, user, options = {}) {
  const userId = user?._id ? String(user._id) : 'unknown';
  log.debug('Executing tool', { name, userId });
  if (name === 'create_task_plan')
    return createTaskPlan(args, options.agentState, options.onAgentEvent);
  if (name === 'update_task_status')
    return updatePlannedTask(args, options.agentState, options.onAgentEvent);
  if (name === 'generate_image') {
    return generateImageArtifact(args, user, {
      signal: options.signal,
      chatId: options.chatId,
      onProgress: (progress) => options.onAgentEvent?.('image_progress', progress),
    });
  }
  if (name === 'execute_python') {
    if (!user?._id || String(user._id).startsWith('guest:')) {
      log.warn('Python execution denied: not signed in', { userId });
      throw new Error('A signed-in user is required for Python execution.');
    }
    if (options.chatId && !(await getChat(userId, String(options.chatId))))
      throw new Error(
        'This conversation no longer exists. Start a new conversation before running Python.'
      );
    log.debug('Python execution started', {
      userId,
      codeBytes: Buffer.byteLength(String(args.code || ''), 'utf8'),
    });
    const result = await executePython(
      { code: args.code, chatId: options.chatId },
      String(user._id),
      { signal: options.signal, chatId: options.chatId }
    );
    log.debug('Python execution completed', {
      userId,
      status: result.status,
      durationMs: result.durationMs,
    });
    return { ...result, taskContext: String(args.task_context || '').slice(0, 500) };
  }
  if (name === 'save_memory') {
    if (!user?._id || String(user._id).startsWith('guest:')) {
      log.warn('Save memory denied: not signed in', { userId });
      throw new Error('Sign in is required to save memories.');
    }
    const memory = String(args.memory || '').trim();
    if (!memory || memory.length > 2000)
      throw new Error('Memory must be between 1 and 2,000 characters.');
    const existed = Boolean(await User.exists({ _id: user._id, 'memories.text': memory }));
    let updated = await User.findOneAndUpdate(
      { _id: user._id, 'memories.text': { $ne: memory } },
      { $push: { memories: { $each: [{ text: memory, source: 'assistant' }], $slice: -50 } } },
      { new: true }
    )
      .select('memories')
      .lean();
    if (!updated) updated = await User.findById(user._id).select('memories').lean();
    log.info('Memory saved', { userId, duplicate: existed, memory });
    return {
      saved: true,
      duplicate: existed,
      memory,
      totalMemories: updated?.memories?.length || 0,
    };
  }
  if (name === 'search_memories') {
    if (!user?._id || String(user._id).startsWith('guest:')) return { memories: [] };
    const query = String(args.query || '').toLowerCase();
    const doc = await User.findById(user._id).select('memories').lean();
    const found = (doc?.memories || [])
      .filter((m) => !query || m.text.toLowerCase().includes(query))
      .slice(0, 15)
      .map((m) => ({ id: m._id, text: m.text }));
    log.debug('Memory search completed', { userId, query, foundCount: found.length });
    return { memories: found };
  }
  if (name === 'web_search') {
    log.info('Web search started', { userId, query: args.query });
    const result = await tavilySearch(args);
    log.info('Web search completed', {
      userId,
      query: args.query,
      resultCount: result.results?.length || 0,
    });
    return result;
  }
  if (name === 'calculator') {
    const expression = String(args.expression || '');
    if (expression.length > 300) throw new Error('Expression is too long.');
    const result = parser.parse(expression).evaluate({});
    if (!Number.isFinite(result)) throw new Error('Expression did not return a finite number.');
    return { result };
  }
  if (name === 'get_current_datetime') {
    const timezone = String(args.timezone || 'Asia/Kolkata');
    const date = new Date();
    return {
      iso: date.toISOString(),
      timezone,
      local: new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: timezone,
      }).format(date),
    };
  }
  if (name === 'npm_search') {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('A search query is required.');
    log.info('npm search started', { userId, query });
    const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
    const response = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
    const data = await response.json();
    log.info('npm search completed', { userId, query, packageCount: (data.objects || []).length });
    return {
      packages: (data.objects || []).map(({ package: p }) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        links: p.links,
      })),
    };
  }
  if (name === 'github_search') {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('A search query is required.');
    log.info('GitHub search started', { userId, query });
    const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nemotron-Agent-Lab' },
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    const data = await response.json();
    log.info('GitHub search completed', {
      userId,
      query,
      repositoryCount: (data.items || []).length,
    });
    return {
      repositories: (data.items || []).map((repo) => ({
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        stargazers_count: repo.stargazers_count,
        language: repo.language,
      })),
    };
  }
  if (name === 'fetch_public_url') {
    const url = await safeUrl(String(args.url || ''));
    log.info('URL fetch started', { userId, url: url.toString() });
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nemotron-Agent-Lab/1.0',
        Accept: 'text/html,text/plain,application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`URL returned HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!/text\//i.test(type) && !/json/i.test(type))
      throw new Error('Only text, HTML and JSON responses can be fetched.');
    const content = (await response.text()).slice(0, 30000);
    log.info('URL fetch completed', {
      userId,
      url: url.toString(),
      contentType: type,
      contentBytes: content.length,
    });
    return { url: url.toString(), contentType: type, content };
  }
  throw new Error(`Unknown tool: ${name}`);
}
export function getToolDefinitions() {
  return tools;
}
export function getPluginCatalog() {
  return [
    {
      id: 'execute_python',
      name: 'Python interpreter',
      description: 'Full CPython in an isolated Vercel Sandbox microVM',
      icon: 'Code',
      configured: getInterpreterStatus().configured,
    },
    {
      id: 'generate_image',
      name: 'Image generation',
      description: 'Generate and save images with FLUX.1 Schnell',
      icon: 'Image',
      configured: getImageGenerationStatus().configured,
    },
    {
      id: 'create_task_plan',
      name: 'Autonomous planning',
      description: 'Create and track multi-step execution plans',
      icon: 'ListChecks',
      configured: true,
    },
    {
      id: 'save_memory',
      name: 'Save memory',
      description: 'Save user-approved facts for future chats',
      icon: 'MemoryStick',
      configured: true,
    },
    {
      id: 'search_memories',
      name: 'Search memory',
      description: 'Recall saved user context',
      icon: 'MemoryStick',
      configured: true,
    },
    {
      id: 'web_search',
      name: 'Web search',
      description: 'Search current websites and news',
      icon: 'Globe',
      configured: Boolean(process.env.TAVILY_API_KEY),
    },
    {
      id: 'fetch_public_url',
      name: 'Open webpage',
      description: 'Read public URLs and documentation',
      icon: 'Link',
      configured: true,
    },
    {
      id: 'github_search',
      name: 'GitHub',
      description: 'Find public repositories',
      icon: 'Github',
      configured: true,
    },
    {
      id: 'npm_search',
      name: 'npm',
      description: 'Search npm packages',
      icon: 'Package',
      configured: true,
    },
    {
      id: 'calculator',
      name: 'Calculator',
      description: 'Evaluate calculations',
      icon: 'Calculator',
      configured: true,
    },
    {
      id: 'get_current_datetime',
      name: 'Date & time',
      description: 'Get timezone-aware current time',
      icon: 'Clock',
      configured: true,
    },
  ];
}
export async function runTool(name, args, user, options = {}) {
  const userId = user?._id ? String(user._id) : 'unknown';
  try {
    log.debug('Tool execution started', { name, userId });
    const result = await executeTool(name, args, user, options);
    log.debug('Tool execution completed', { name, userId });
    return { ok: true, result: result };
  } catch (error) {
    log.warn('Tool execution failed', {
      name,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
