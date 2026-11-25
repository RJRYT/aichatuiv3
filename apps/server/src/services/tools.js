import { Parser } from 'expr-eval';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Share } from '../models/Share.js';
import { User } from '../models/User.js';
import { decryptUserIntegrations } from './integrations/crypto.js';
import { isPluginEnabled, isToolUserConfigurable } from './toolPolicy.js';
export { isPluginEnabled, isToolUserConfigurable } from './toolPolicy.js';
import logger from '../utils/logger.js';
import { createTaskPlan, updatePlannedTask } from './agentPlanning.js';
import { getLatestAgentCheckpoint } from './agents/checkpointManager.js';
import { listArtifacts, getArtifact } from './interpreter/artifactStore.js';
import { listOwnerUploadMetadata, getOwnerUpload } from './interpreter/uploadStore.js';
import { getChat, searchChatContexts } from './chatStore.js';
import { generateImageArtifact, getImageGenerationStatus } from './imageGeneration.js';
import { executePython } from './interpreter/interpreter.js';
import { executeNodeInSandbox, getInterpreterStatus } from './interpreter/sandboxManager.js';
import { acquireExecution } from './interpreter/executionQueue.js';
import {
  archiveWorkspace, createWorkspaceFile, deleteWorkspaceFile, editWorkspaceFile,
  exportWorkspaceFile, getWorkspaceSnapshot, getWorkspaceStatus, listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles,
} from './workspace/workspaceManager.js';

const log = logger.child({ component: 'tools' });

const parser = new Parser({
  operators: { logical: false, comparison: false, in: false, assignment: false },
});

const tools = [

  { type: 'function', function: { name: 'youtube_search', description: 'Search YouTube using ytsearch.js. Search videos, channels, playlists, movies or live streams; choose relevance, upload_date, view_count or rating sorting and a bounded result count. Use this for finding videos and creators, not for general web search.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 300 }, type: { type: 'string', enum: ['video', 'channel', 'playlist', 'movie', 'live', 'any'] }, sort: { type: 'string', enum: ['relevance', 'upload_date', 'view_count', 'rating'] }, limit: { type: 'integer', minimum: 10, maximum: 50 }, pages: { type: 'integer', minimum: 1, maximum: 3, description: 'Fetch one to three result pages in a single bounded call.' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'youtube_video_details', description: 'Fetch detailed public metadata for one YouTube video by its video ID. Use after youtube_search when a user asks for details about a particular video.', parameters: { type: 'object', properties: { video_id: { type: 'string', minLength: 6, maxLength: 32 } }, required: ['video_id'] } } },
  { type: 'function', function: { name: 'youtube_playlist_items', description: 'Fetch metadata and a page of videos from a YouTube playlist. Returns a next-page indicator for follow-up retrieval.', parameters: { type: 'object', properties: { playlist_id: { type: 'string', minLength: 8, maxLength: 80 }, limit: { type: 'integer', minimum: 10, maximum: 100 }, pages: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['playlist_id'] } } },
  { type: 'function', function: { name: 'file_library_search', description: 'Search the signed-in user File Library for project-related artifacts. Use query to find source archives, reports, generated documents, images, or other deliverables. When read_file_id is supplied, read a bounded text artifact and return its contents. Never expose private download URLs.', parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 160 }, read_file_id: { type: 'string' }, max_chars: { type: 'integer', minimum: 500, maximum: 12000 } } } } },
  { type: 'function', function: { name: 'workspace_list', description: 'List files in the private server-side conversation workspace. The user cannot directly browse these files. Use this to inspect project structure and file revisions. This is a native file operation; it does not start Python or Node.js.', parameters: { type: 'object', properties: { prefix: { type: 'string', description: 'Optional relative directory prefix.' } } } } },
  { type: 'function', function: { name: 'workspace_read', description: 'Read a text file from the private server-side conversation workspace. The user cannot directly access workspace paths. Use this before editing unfamiliar or existing files. Large files can be read in chunks using start_line and max_lines; continue from nextLine when truncated is true. This does not start a runtime.', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, max_lines: { type: 'integer', minimum: 1, maximum: 500 } }, required: ['path'] } } },
  { type: 'function', function: { name: 'workspace_create', description: 'Create a complete text source file in the private server-side conversation workspace. The user cannot directly access workspace paths or browse this filesystem. This does not execute code. Existing files are not overwritten unless overwrite=true. After creating a requested deliverable, call workspace_export to publish a downloadable File Library artifact; never tell the user to retrieve a file from the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'workspace_edit', description: 'Edit an existing workspace file without running a code interpreter. Prefer exact oldText/newText replacement with expectedRevision from workspace_read. Supports append, exact replace, or full overwrite.', parameters: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string', enum: ['append', 'replace', 'overwrite'] }, oldText: { type: 'string' }, newText: { type: 'string' }, content: { type: 'string' }, expectedRevision: { type: 'integer' }, replaceAll: { type: 'boolean' } }, required: ['path', 'mode'] } } },
  { type: 'function', function: { name: 'workspace_delete', description: 'Delete a file from the current conversation workspace. Use only when deletion is necessary for the requested change.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'workspace_search', description: 'Search text content across files in the current conversation workspace.', parameters: { type: 'object', properties: { query: { type: 'string' }, prefix: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'workspace_status', description: 'Get current workspace file count, size, and storage limits.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'workspace_export', description: 'Export a workspace file as a user-downloadable File Library artifact and return its artifact metadata for an inline download card. Use this after creating or editing a requested deliverable (HTML, source file, document, etc.). Creating a workspace file alone does NOT deliver it to the user.', parameters: { type: 'object', properties: { path: { type: 'string' }, name: { type: 'string', description: 'Optional download filename.' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'workspace_archive', description: 'Create a verified ZIP archive of non-secret workspace files and save it as a downloadable artifact. Sensitive files such as .env and private keys are excluded. Use only when the user requests an archive or when packaging is genuinely necessary for delivery.', parameters: { type: 'object', properties: { name: { type: 'string' } } } } },
  {
    type: 'function',
    function: {
      name: 'report_progress',
      description:
        'Send a concise user-facing progress update while working. Use this at meaningful milestones, especially before a lengthy operation and after completing a significant step. Write one natural sentence in first person describing the action you are actually taking or a verified finding. This is NOT a place for private chain-of-thought, hidden reasoning, speculative plans, generic filler, or a list of internal thoughts. Examples of style: “I found the relevant files and am checking how the upload flow works.” or “The implementation is in place; I’m running the focused tests now.”',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            minLength: 8,
            maxLength: 280,
            description:
              'One concise, user-safe sentence about the current action or verified progress.',
          },
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
        'Run Python code in an isolated execution environment. Use for Python-specific execution, computation, data processing, automation, document generation, image processing, charts, and Python application testing. A non-secret snapshot of the current project workspace is materialized into the sandbox working directory when a workspace exists. Changes to eligible text files and deletions are synchronized back to the durable workspace; binary outputs are saved to the File Library. For ordinary source-file creation, reading, editing, searching, and project organization, use native workspace tools instead; do not start Python merely to write files. Uploaded files are mounted under uploads/. Generated files are collected into the user File Library. Inspect execution status, stdout, stderr, exit code and artifact metadata. Never claim success unless execution completed.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'Complete Python source code for the computation or Python program that genuinely needs execution. Do not use this tool as a wrapper for routine workspace file creation. Write generated outputs into the current working directory. Inspect stdout, stderr, exitCode, status and artifact metadata.',
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
      name: 'execute_node',
      description: 'Run an isolated Node.js, npm, or npx command against a clean snapshot of the current conversation workspace. Changes to eligible UTF-8 text files and deletions are synchronized back to the durable workspace; generated binary files are saved to the File Library. Use for JavaScript syntax checks, Node.js scripts, dependency installation, Vite/React builds, and Node tests. Use only when the Node.js execution capability is enabled.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['node', 'npm', 'npx'] },
          args: { type: 'array', items: { type: 'string' }, maxItems: 64 },
          timeout_ms: { type: 'integer', minimum: 10000, maximum: 300000 },
        },
        required: ['command', 'args'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_status',
      description: 'Inspect the latest persisted agent-run checkpoint for this conversation. Use when the user asks to resume or continue earlier work, or when you need to understand what was completed before an interruption. This returns operation summaries, not source contents.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task_plan',
      description:
        'Create a visible execution plan when it materially helps coordinate a complex or resumable task. Keep the objective and ordered tasks concise, with stable IDs and dependencies. Planning is optional and does not execute tasks by itself.',
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
      name: 'list_shared_links',
      description:
        'List the signed-in user’s active public share links. Use only when the user asks to find or list their shared links. Never list or access another user’s shares.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_previous_chats',
      description:
        'Search the signed-in user’s previous conversations for relevant context. Use only when the user explicitly asks to find, recall, or continue an earlier conversation. Searches only chats owned by the current user and returns a few relevant message excerpts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            minLength: 2,
            maxLength: 120,
            description: 'A distinctive topic, phrase, project, or decision to find.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 5 },
        },
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
  if (!args._apiKey && !process.env.TAVILY_API_KEY)
    throw new Error('Web search is not configured. Enable the search capability or contact the administrator.');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: String(args._apiKey || process.env.TAVILY_API_KEY || ''),
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
  if (!response.ok) throw new Error(data.detail || `The web-search service returned HTTP ${response.status}`);
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

  if (name === 'youtube_search' || name === 'youtube_video_details' || name === 'youtube_playlist_items') {
    let youtube;
    try { youtube = await import('ytsearch.js'); }
    catch { throw new Error('YouTube search is not installed. Install the ytsearch.js package on the server and restart the application.'); }
    if (name === 'youtube_search') {
      let result = await youtube.searchYouTube(String(args.query || '').trim(), {
        type: ['video', 'channel', 'playlist', 'movie', 'live', 'any'].includes(args.type) ? args.type : 'video',
        sort: ['relevance', 'upload_date', 'view_count', 'rating'].includes(args.sort) ? args.sort : 'relevance',
        limit: Math.max(10, Math.min(50, Number(args.limit) || 20)),
      });
      const aggregate = { videos: [...(result.videos || [])], channels: [...(result.channels || [])], playlists: [...(result.playlists || [])], movies: [...(result.movies || [])], lives: [...(result.lives || [])] };
      const requestedPages = Math.max(1, Math.min(3, Number(args.pages) || 1));
      let pagesFetched = 1;
      for (let page = 1; page < requestedPages && typeof result.nextPage === 'function'; page++) {
        const next = await result.nextPage();
        if (!next) break;
        result = next;
        for (const key of Object.keys(aggregate)) aggregate[key].push(...(next[key] || []));
        pagesFetched++;
      }
      const compact = (items = []) => items.slice(0, 150).map((item) => ({
        id: item.id, type: item.type, title: item.title, description: item.description,
        thumbnail: item.thumbnail, thumbnails: item.thumbnails, url: item.url || item.watchUrl,
        watchUrl: item.watchUrl, duration: item.duration, viewCount: item.viewCount,
        shortViewCount: item.shortViewCount, publishedAt: item.publishedAt,
        author: item.author, subscriberCount: item.subscriberCount, videoCount: item.videoCount,
        verified: item.verified, isLive: item.isLive,
      }));
      return { query: String(args.query || '').trim(), videos: compact(aggregate.videos), channels: compact(aggregate.channels), playlists: compact(aggregate.playlists), movies: compact(aggregate.movies), lives: compact(aggregate.lives), metadata: result.metadata, pagesFetched, hasNextPage: Boolean(result.metadata?.hasNextPage) };
    }
    if (name === 'youtube_video_details') {
      const details = await youtube.getVideoDetails(String(args.video_id || '').trim());
      return { video: details };
    }
    let result = await youtube.getPlaylistItems(String(args.playlist_id || '').trim(), { limit: Math.max(10, Math.min(100, Number(args.limit) || 50)) });
    const playlist = result.playlist;
    const videos = [...(result.videos || [])];
    const requestedPages = Math.max(1, Math.min(3, Number(args.pages) || 1));
    let pagesFetched = 1;
    for (let page = 1; page < requestedPages && typeof result.nextPage === 'function'; page++) {
      const next = await result.nextPage();
      if (!next) break;
      result = next;
      videos.push(...(next.videos || []));
      pagesFetched++;
    }
    return { playlist, videos: videos.slice(0, 300), metadata: result.metadata, pagesFetched, hasNextPage: Boolean(result.metadata?.hasNextPage) };
  }
  if (name === 'file_library_search') {
    if (!user?._id || String(user._id).startsWith('guest:')) throw new Error('Sign in is required to access the File Library.');
    if (args.read_file_id) {
      const file = await getArtifact(String(args.read_file_id), userId) || await getOwnerUpload(userId, String(args.read_file_id));
      if (!file) throw new Error('File Library item was not found or is not accessible.');
      const textual = /^(text\/|application\/(json|xml|javascript|x-javascript)|application\/x-yaml)/i.test(file.mimeType || '') || /\.(txt|md|csv|json|xml|ya?ml|js|jsx|ts|tsx|py|html|css|sql|log)$/i.test(file.name || '');
      if (!textual) return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, readable: false, message: 'This artifact is binary or not a supported text format. It is available in the File Library.' };
      const maxChars = Math.max(500, Math.min(12000, Number(args.max_chars) || 8000));
      return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, readable: true, truncated: file.data.toString('utf8').length > maxChars, content: file.data.toString('utf8').slice(0, maxChars) };
    }
    const [result, uploads] = await Promise.all([listArtifacts(userId, { search: String(args.query || ''), limit: 30 }), listOwnerUploadMetadata(userId, 30)]);
    const term = String(args.query || '').trim().toLowerCase();
    const uploadedFiles = uploads.files.filter((file) => !term || `${file.name} ${file.mimeType || ''}`.toLowerCase().includes(term));
    return { total: result.total + uploadedFiles.length, files: [...result.files.map(({ id, name, size, mimeType, chatId, relativePath, createdAt }) => ({ id, name, size, mimeType, chatId, relativePath, createdAt, kind: 'generated' })), ...uploadedFiles.map(({ id, uploadId, name, size, mimeType, chatId, createdAt }) => ({ id: uploadId || id, name, size, mimeType, chatId, createdAt, kind: 'uploaded' }))].slice(0, 30) };
  }
  if (name.startsWith('workspace_')) {
    if (!user?._id || String(user._id).startsWith('guest:')) throw new Error('Sign in is required for persistent workspace operations.');
    const chatId = String(options.chatId || '');
    if (name === 'workspace_list') return listWorkspaceFiles(userId, chatId, args.prefix || '');
    if (name === 'workspace_read') return readWorkspaceFile(userId, chatId, args.path, { startLine: args.start_line, maxLines: args.max_lines });
    if (name === 'workspace_create') return createWorkspaceFile(userId, chatId, args.path, args.content, { overwrite: Boolean(args.overwrite) });
    if (name === 'workspace_edit') return editWorkspaceFile(userId, chatId, args.path, args);
    if (name === 'workspace_delete') return deleteWorkspaceFile(userId, chatId, args.path);
    if (name === 'workspace_search') return searchWorkspaceFiles(userId, chatId, args.query, args.prefix || '');
    if (name === 'workspace_status') return getWorkspaceStatus(userId, chatId);
    if (name === 'workspace_export') return exportWorkspaceFile(userId, chatId, args.path, args.name || '');
    if (name === 'workspace_archive') return archiveWorkspace(userId, chatId, args.name || 'project.zip');
  }
  if (name === 'get_agent_status') {
    if (!user?._id || String(user._id).startsWith('guest:')) throw new Error('Sign in is required to inspect agent checkpoints.');
    if (!options.chatId) throw new Error('A conversation is required to inspect agent checkpoints.');
    return { checkpoint: await getLatestAgentCheckpoint(userId, String(options.chatId)) };
  }
  if (name === 'create_task_plan')
    return createTaskPlan(args, options.agentState, options.onAgentEvent);
  if (name === 'update_task_status')
    return updatePlannedTask(args, options.agentState, options.onAgentEvent);
  if (name === 'generate_image') {
    if (options.integrations?.errors?.cloudflare) throw new Error('Image-generation credentials could not be accessed. Re-enter the saved credentials in Personal Integrations.');
    return generateImageArtifact(args, user, {
      signal: options.signal,
      chatId: options.chatId,
      credentials: options.integrations?.cloudflare,
      onProgress: (progress) => options.onAgentEvent?.('image_progress', progress),
    });
  }
  if (name === 'execute_python') {
    if (options.integrations?.errors?.vercel) throw new Error('Execution credentials could not be accessed. Re-enter the saved credentials in Personal Integrations.');
    if (!user?._id || String(user._id).startsWith('guest:')) {
      log.warn('Python execution denied: not signed in', { userId });
      throw new Error('A signed-in user is required for Python execution.');
    }
    if (options.chatId && !(await getChat(userId, String(options.chatId))))
      throw new Error(
        'This conversation no longer exists. Start a new conversation before running Python.'
      );
    const workspaceFiles = options.chatId ? await getWorkspaceSnapshot(userId, String(options.chatId)) : [];
    const result = await executePython(
      { code: args.code, chatId: options.chatId },
      String(user._id),
      {
        signal: options.signal,
        chatId: options.chatId,
        archiveOnly: Boolean(options.archiveOnly),
        workspaceFiles,
        sandboxCredentials: options.integrations?.vercel,
      }
    );
    return { ...result, taskContext: String(args.task_context || '').slice(0, 500) };
  }
  if (name === 'execute_node') {
    if (options.integrations?.errors?.vercel) throw new Error('Execution credentials could not be accessed. Re-enter the saved credentials in Personal Integrations.');
    if (!user?._id || String(user._id).startsWith('guest:')) throw new Error('A signed-in user is required for Node.js execution.');
    if (!options.chatId || !(await getChat(userId, String(options.chatId)))) throw new Error('A valid conversation is required for Node.js execution.');
    if (!process.env.VERCEL_NODE_SANDBOX_IMAGE) throw new Error('Node.js execution is not configured. Contact the administrator to enable this capability.');
    if (!options.integrations?.vercel?.token && !getInterpreterStatus().configured) throw new Error('Node.js execution is not configured. Enable the Node.js execution capability or contact the administrator.');
    const workspaceFiles = await getWorkspaceSnapshot(userId, String(options.chatId));
    const release = acquireExecution(userId);
    try {
      return await executeNodeInSandbox({
        command: args.command,
        args: Array.isArray(args.args) ? args.args : [],
        timeoutMs: args.timeout_ms,
        userId,
        chatId: String(options.chatId),
        signal: options.signal,
        workspaceFiles,
        sandboxCredentials: options.integrations?.vercel,
      });
    } finally { release(); }
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
    return { memories: found };
  }
  if (name === 'list_shared_links') {
    if (!user?._id || String(user._id).startsWith('guest:'))
      throw new Error('Sign in is required to access your shared links.');
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
    const shares = await Share.find({ ownerId: userId, revokedAt: null })
      .select('shareId title shareType createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const baseUrl = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return {
      shares: shares.map((share) => ({
        title: String(share.title || 'Shared conversation').slice(0, 120),
        shareType: share.shareType || 'snapshot',
        createdAt: share.createdAt || null,
        url: `${baseUrl}/share/${encodeURIComponent(share.shareId)}`,
      })),
    };
  }
  if (name === 'search_previous_chats') {
    if (!user?._id || String(user._id).startsWith('guest:'))
      throw new Error('Sign in is required to search previous conversations.');
    const query = String(args.query || '')
      .trim()
      .slice(0, 120);
    if (query.length < 2) throw new Error('Enter at least two characters to search chats.');
    const chats = await searchChatContexts(userId, query, {
      excludeChatId: options.chatId,
      limit: args.limit,
    });
    return { chats };
  }
  if (name === 'web_search') {
    if (options.integrations?.errors?.tavily) throw new Error('Web-search credentials could not be accessed. Re-enter the saved credentials in Personal Integrations.');
    const result = await tavilySearch({ ...args, _apiKey: options.integrations?.tavily?.apiKey });
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
    const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
    const response = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
    const data = await response.json();
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
    const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nemi' },
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    const data = await response.json();
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
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nemi/1.0',
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
    return { url: url.toString(), contentType: type, content };
  }
  throw new Error(`Unknown tool: ${name}`);
}
export function getToolDefinitions(user) {
  const enabled = (pluginId) => isPluginEnabled(user, pluginId);
  const personalVercel = decryptUserIntegrations(user).vercel || {};
  const vercelReady = Boolean((personalVercel.token && personalVercel.teamId && personalVercel.projectId) || getInterpreterStatus().configured);
  const builtins = tools.filter((tool) => enabled(tool.function.name) && (tool.function.name !== 'execute_node' || Boolean(process.env.VERCEL_NODE_SANDBOX_IMAGE && vercelReady)));
  return builtins;
}

export function getPluginCatalog() {
  const nodeConfigured = Boolean(process.env.VERCEL_NODE_SANDBOX_IMAGE && getInterpreterStatus().configured);
  return [
    { id: 'execute_python', name: 'Python sandbox', description: 'Run Python in an isolated execution environment.', icon: 'Code2', configurable: true, defaultEnabled: true, configured: getInterpreterStatus().configured },
    { id: 'execute_node', name: 'Node.js sandbox', description: 'Run Node.js commands in an isolated execution environment.', icon: 'Terminal', configurable: true, defaultEnabled: true, configured: nodeConfigured },
    { id: 'web_search', name: 'Web search', description: 'Search the public web for current information.', icon: 'Globe', configurable: true, defaultEnabled: true, configured: Boolean(process.env.TAVILY_API_KEY) },
    { id: 'generate_image', name: 'Image generation', description: 'Generate original images.', icon: 'Image', configurable: true, defaultEnabled: true, configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) },
  ];
}
export async function runTool(name, args, user, options = {}) {
  try {
    if (!isPluginEnabled(user, name))
      return { ok: false, error: `The ${name} tool is disabled in your plugin settings.` };
    const result = await executeTool(name, args, user, options);
    return { ok: true, result: result };
  } catch (error) {
    log.warn('Tool execution failed', {
      name,
      userId: user?._id ? String(user._id) : 'unknown',
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
