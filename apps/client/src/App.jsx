import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bot,
  Brain,
  Calculator,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Download,
  Eye,
  FileArchive,
  FileImage,
  Files,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderCog,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  LoaderCircle,
  LogOut,
  Maximize,
  MessageSquare,
  Minimize,
  PanelLeft,
  Paperclip,
  Pencil,
  PencilLine,
  Pin,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Trash2,
  UserRound,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildChatExport, chatExportFilename } from './chatExport.js';
import {
  chatErrorMessage,
  ChatStreamError,
  fetchChatStream,
  readChatEventStream,
  responseError,
} from './chatStream.js';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const DEFAULT_PREFERENCES = {
  baseStyle: 'friendly',
  tone: 'balanced',
  warmth: 3,
  enthusiasm: 3,
  emoji: 'moderate',
  visualAnswers: true,
  headers: true,
  lists: true,
  activeModel: 'auto',
  persona: 'agent',
  personaInstructions: '',
  personality: { professionalism: 80, friendliness: 75, humor: 35, directness: 75, explanatoryDepth: 65, criticalThinking: 90, creativity: 70, confidence: 80, curiosity: 75, analyticalDepth: 85, autonomy: 75, initiative: 80, empathy: 70, thoroughness: 85, riskTolerance: 35, intensity: 70 },
};
const PLUGIN_CATALOG = [
  { id: 'execute_python', name: 'Python sandbox', description: 'execute code in an isolated environment', configurable: true },
  { id: 'execute_node', name: 'Node.js sandbox', description: 'run npm, node and build commands', configurable: true },
  { id: 'web_search', name: 'Web search', description: 'search the live web with Tavily', configurable: true },
  { id: 'generate_image', name: 'Image generation', description: 'generate images with Cloudflare Workers AI', configurable: true },
  { id: 'workspace_delete', name: 'Workspace deletion', description: 'allow the agent to delete project files', configurable: true },
  { id: 'workspace_archive', name: 'ZIP packaging', description: 'allow the agent to package project workspaces', configurable: true },
  { id: 'github_search', name: 'GitHub search', description: 'search public repositories', configurable: false },
  { id: 'npm_search', name: 'npm search', description: 'search npm packages', configurable: false },
  { id: 'calculator', name: 'Calculator', description: 'evaluate calculations', configurable: false },
  { id: 'fetch_public_url', name: 'Open webpage', description: 'read public documentation and pages', configurable: false },
  { id: 'get_current_datetime', name: 'Date & time', description: 'timezone-aware current time', configurable: false },
  { id: 'workspace_list', name: 'Workspace files', description: 'inspect project files', configurable: false },
  { id: 'workspace_read', name: 'Workspace reading', description: 'read project source files', configurable: false },
  { id: 'workspace_create', name: 'Workspace creation', description: 'create project files', configurable: false },
  { id: 'workspace_edit', name: 'Workspace editing', description: 'edit project files', configurable: false },
  { id: 'workspace_search', name: 'Workspace search', description: 'search across project files', configurable: false },
  { id: 'workspace_status', name: 'Workspace status', description: 'inspect workspace storage', configurable: false },
  { id: 'create_task_plan', name: 'Task planning', description: 'plan and track complex work', configurable: false },
  { id: 'save_memory', name: 'Save memory', description: 'save durable user context', configurable: false },
  { id: 'search_memories', name: 'Search memory', description: 'recall saved context', configurable: false },
  { id: 'search_previous_chats', name: 'Previous chats', description: 'recall earlier conversations', configurable: false },
  { id: 'list_shared_links', name: 'Shared links', description: 'list your active share links', configurable: false },
];
const COLOR_THEMES = [
  { id: 'forest', name: 'Forest', colors: ['#0b0e0c', '#a4df78'] },
  { id: 'midnight', name: 'Midnight', colors: ['#090d18', '#8ba7ff'] },
  { id: 'ocean', name: 'Ocean', colors: ['#07151b', '#50c6d8'] },
  { id: 'purple', name: 'Amethyst', colors: ['#130d1b', '#bd91f5'] },
  { id: 'rose', name: 'Rose', colors: ['#1b0e13', '#f28ca8'] },
  { id: 'sunset', name: 'Sunset', colors: ['#1b100b', '#ffad70'] },
  { id: 'light', name: 'Light', colors: ['#f4f6f8', '#3478d4'] },
  { id: 'dracula', name: 'Dracula', colors: ['#282a36', '#bd93f9'] },
  { id: 'nord', name: 'Nord', colors: ['#2e3440', '#88c0d0'] },
  { id: 'solarized', name: 'Solarized', colors: ['#002b36', '#2aa198'] },
];
const SUGGESTIONS = [
  {
    icon: Search,
    label: 'Research a topic',
    prompt:
      'Research the latest developments in AI coding agents. Use web search and cite reliable sources.',
  },
  {
    icon: Code2,
    label: 'Analyze a dataset',
    prompt:
      'I want to analyze a CSV dataset, calculate useful statistics, identify patterns, and create clear visualizations. Ask me to attach the CSV.',
  },
  {
    icon: Code2,
    label: 'Build something',
    prompt:
      'Help me design and implement a production-ready feature. Start by clarifying requirements and proposing an implementation plan.',
  },
  {
    icon: Github,
    label: 'Explore GitHub',
    prompt:
      'Find popular open-source JavaScript repositories for building agentic applications. Compare their features and licenses.',
  },
  {
    icon: Sparkles,
    label: 'Think through an idea',
    prompt:
      'Help me evaluate a product idea. Analyze feasibility, architecture, risks, and an MVP roadmap.',
  },
];
// crypto.randomUUID is only available in secure contexts (https or localhost);
// fall back for LAN/preview hosts served over plain HTTP.
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const MAX_TEXT_CHARS = 30000;
const MAX_MULTIMODAL_TEXT_CHARS = 20000;

// Touch-first devices (phones, tablets): Enter on the virtual keyboard inserts a
// newline and messages are sent with the send button only.
const IS_TOUCH_ONLY =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function api(path) {
  return `${API_BASE}${path}`;
}
async function request(path, options = {}) {
  const response = await fetch(api(path), {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data.error = await response.text();
    }
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response;
}
function textOf(content) {
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n')
      : '';
}
function dateLabel(value) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : '';
}
function titleFallback(text) {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > 58 ? `${value.slice(0, 58)}…` : value || 'New chat';
}
function latestActivePlan(messages = []) {
  const plan = [...messages].reverse().find((message) => message.agentPlan)?.agentPlan;
  if (!plan?.tasks?.length) return null;
  return plan.tasks.every((task) => ['completed', 'skipped'].includes(task.status)) ? null : plan;
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function textFile(name, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  return new File([blob], name, { type: 'text/plain' });
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function prepareImage(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} exceeds the 12 MB image limit.`);
  const src = await readFile(file),
    img = await loadImage(src),
    scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    name: file.name,
    sandboxName: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    type: file.type || 'image/jpeg',
    sandboxMimeType: 'image/jpeg',
    dataUrl: canvas.toDataURL('image/jpeg', 0.84),
    preview: canvas.toDataURL('image/jpeg', 0.5),
  };
}
async function prepareAudio(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} exceeds the 15 MB audio limit.`);
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['mp3', 'wav'].includes(extension)) throw new Error('Nemotron Omni currently accepts MP3 and WAV audio files.');
  const mimeType = extension === 'wav' ? 'audio/wav' : 'audio/mpeg';
  return { name: file.name, type: mimeType, dataUrl: await readFile(file), kind: 'audio' };
}
async function prepareVideo(file) {
  if (file.size > 45 * 1024 * 1024) throw new Error(`${file.name} exceeds the 45 MB video limit.`);
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = reject;
    });
    const duration = video.duration;
    if (!duration || !Number.isFinite(duration)) throw new Error(`Cannot decode ${file.name}.`);
    const count = Math.min(6, Math.max(2, Math.ceil(duration / 15))),
      canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1280) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 720) * scale));
    const ctx = canvas.getContext('2d'),
      frames = [];
    for (let i = 0; i < count; i++) {
      const time = Math.min(duration - 0.05, (duration * i) / (count - 1));
      video.currentTime = Math.max(0, time);
      await new Promise((resolve, reject) => {
        video.onseeked = resolve;
        video.onerror = reject;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ time, dataUrl: canvas.toDataURL('image/jpeg', 0.78) });
    }
    return { name: file.name, type: file.type, frames, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function prepareFiles(files) {
  if (files.length > 6) throw new Error('Attach up to 6 files per message.');
  const out = [];
  const supported = new Set([
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/tab-separated-values',
    'application/json',
    'application/xml',
    'application/zip',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/x-python',
    'text/javascript',
    'application/javascript',
    'text/html',
    'text/css',
    'application/sql',
    'text/x-sql',
    'application/yaml',
    'text/yaml',
    'application/toml',
    'text/x-shellscript',
    'application/x-sh',
  ]);
  const extensionMime = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    py: 'text/x-python',
    js: 'text/javascript',
    jsx: 'text/javascript',
    mjs: 'text/javascript',
    cjs: 'text/javascript',
    ts: 'text/javascript',
    tsx: 'text/javascript',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    sql: 'application/sql',
    yml: 'application/yaml',
    yaml: 'application/yaml',
    toml: 'application/toml',
    ini: 'text/plain',
    cfg: 'text/plain',
    conf: 'text/plain',
    log: 'text/plain',
    sh: 'text/x-shellscript',
    env: 'text/plain',
  };
  for (const file of files) {
    if (file.type.startsWith('image/')) out.push(await prepareImage(file));
    else if (file.type.startsWith('video/')) out.push(await prepareVideo(file));
    else if (file.type.startsWith('audio/') || /\.(mp3|wav)$/i.test(file.name)) out.push(await prepareAudio(file));
    else if (
      supported.has(file.type) ||
      /\.(pdf|txt|md|csv|tsv|json|xml|zip|xlsx?|docx?|pptx|py|jsx?|mjs|cjs|tsx?|html?|css|sql|ya?ml|toml|ini|cfg|conf|log|sh|env)$/i.test(
        file.name
      )
    ) {
      if (file.size > 8 * 1024 * 1024)
        throw new Error(`${file.name} exceeds the 8 MB document limit.`);
      const ext = file.name.split('.').pop().toLowerCase();
      const mimeType = supported.has(file.type) ? file.type : extensionMime[ext] || file.type;
      if (!supported.has(mimeType)) throw new Error(`Unsupported file type: ${file.name}`);
      const rawDataUrl = await readFile(file);
      const dataUrl = rawDataUrl.replace(/^data:[^;]+;base64,/, `data:${mimeType};base64,`);
      out.push({
        name: file.name,
        type: mimeType,
        sandboxMimeType: mimeType,
        dataUrl,
        kind: 'document',
      });
    } else throw new Error(`Unsupported file type: ${file.name}`);
  }
  return out;
}

const RUNNABLE = new Set(['python', 'py']);
const CodeBlock = React.memo(({ children, className = '' }) => {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [runState, setRunState] = useState('idle');
  const [runOutput, setRunOutput] = useState('');
  const code = String(children ?? '').replace(/\n$/, '');
  const language = className.match(/language-([\w-]+)/)?.[1] || 'code';
  const runnable = RUNNABLE.has(language);
  const runCode = async () => {
    if (runState === 'running') return;
    setRunState('running');
    setRunOutput('');
    try {
      const response = await request('/api/interpreter/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          executionId: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      const logs = [data.stdout, data.stderr].filter(Boolean).join('\n');
      const result = data.result && data.result !== 'undefined' ? `\n→ ${data.result}` : '';
      const err = data.error ? `\n${data.error}` : '';
      setRunOutput(`${logs}${result}${err}`.trim() || '(no output)');
      setRunState(data.status === 'completed' ? 'done' : 'error');
    } catch (error) {
      setRunOutput(`Run failed: ${error.message}`);
      setRunState('error');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  const toggleCollapse = () => setCollapsed((v) => !v);
  const toggleFullscreen = () => setFullscreen((v) => !v);
  return (
    <div className={`code-shell ${fullscreen ? 'fullscreen' : ''}`}>
      <div className="code-head">
        <span style={{ marginRight: 'auto' }}>{language}</span>
        <button type="button" onClick={toggleCollapse} aria-label="Collapse">
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        <button type="button" onClick={toggleFullscreen} aria-label="Full screen">
          {fullscreen ? <Minimize size={12} /> : <Maximize size={12} />}
        </button>
        <button type="button" onClick={copy} aria-label="Copy code">
          <Copy size={12} />
        </button>
        {runnable && (
          <button
            type="button"
            onClick={runCode}
            aria-label="Run code"
            title="Run in Python sandbox"
          >
            {runState === 'running' ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
          </button>
        )}
      </div>
      {runOutput && (
        <div className={`code-run-output ${runState}`}>
          <span>{runOutput}</span>
        </div>
      )}
      {!collapsed && (
        <pre className="code-block">
          <code className={className}>{code}</code>
        </pre>
      )}
    </div>
  );
});
function Markdown({ content }) {
  const components = useMemo(
    () => ({
      a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
      pre: ({ node, children }) => (
        <CodeBlock className={children?.props?.className || ''}>
          {children?.props?.children ?? children}
        </CodeBlock>
      ),
      code: ({ node, className, children, ...p }) => (
        <code className={className || 'inline-code'} {...p}>
          {children}
        </code>
      ),
      table: ({ node, ...p }) => (
        <div className="table-wrap">
          <table {...p} />
        </div>
      ),
    }),
    []
  );
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}
function PluginIcon({ name, size = 15 }) {
  const Icon =
    name === 'execute_python'
      ? Code2
      : name === 'generate_image'
        ? ImageIcon
        : name.includes('task_plan') || name.includes('task_status')
          ? ListChecks
          : name.includes('memory')
            ? Brain
            : Wrench;
  return <Icon size={size} />;
}
function toolUsageIcon(name) {
  switch (name) {
    case 'execute_python':
      return Code2;
    case 'create_task_plan':
    case 'update_task_status':
      return ListChecks;
    case 'web_search':
      return Search;
    case 'fetch_public_url':
      return Globe;
    case 'generate_image':
      return ImageIcon;
    case 'calculator':
      return Calculator;
    case 'github_search':
      return Github;
    case 'npm_search':
      return Search;
    case 'search_memories':
    case 'save_memory':
      return Brain;
    case 'get_current_datetime':
      return Clock;
    case 'list_shared_links':
      return Share2;
    case 'search_previous_chats':
      return MessageSquare;
    default:
      return Wrench;
  }
}
function artifactPreviewKind(file) {
  const mime = String(file?.mimeType || '').toLowerCase();
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (
    mime.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript'].includes(mime)
  )
    return 'text';
  return 'none';
}
async function fetchArtifactBlob(file) {
  const artifactPath =
    file.downloadUrl || `/api/interpreter/artifacts/${encodeURIComponent(file.id)}`;
  const response = await fetch(api(artifactPath), {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    let message = `Could not retrieve ${file.name} (${response.status}).`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      /* keep status message */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  if (!blob.size)
    throw new Error(
      `${file.name} was returned as an empty file. The stored artifact may be damaged.`
    );
  if (Number(file.size) > 0 && blob.size !== Number(file.size))
    throw new Error(
      `${file.name} failed its size check (expected ${formatBytes(
        file.size
      )}, received ${formatBytes(blob.size)}).`
    );
  return blob;
}
async function downloadArtifact(file) {
  const blob = await fetchArtifactBlob(file);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name || 'generated-file';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function ArtifactPreview({ file, expanded = false }) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    text: '',
    url: '',
  });
  const kind = artifactPreviewKind(file);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setState({ loading: true, error: '', text: '', url: '' });
    if (kind === 'none') {
      setState({ loading: false, error: '', text: '', url: '' });
      return () => {};
    }
    fetchArtifactBlob(file)
      .then(async (blob) => {
        if (kind === 'text') {
          const text = await blob.text();
          if (!cancelled)
            setState({
              loading: false,
              error: '',
              text: text.slice(0, 12000),
              url: '',
            });
        } else {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setState({ loading: false, error: '', text: '', url: objectUrl });
          else URL.revokeObjectURL(objectUrl);
        }
      })
      .catch((error) => {
        if (!cancelled)
          setState({
            loading: false,
            error: error.message || 'Preview could not be loaded.',
            text: '',
            url: '',
          });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.downloadUrl, file.size, kind]);
  if (kind === 'none')
    return (
      <div className="artifact-preview-unavailable">
        Preview isn't available for this format. Download the original file to open it.
      </div>
    );
  if (state.loading)
    return (
      <div className="artifact-preview-loading">
        <LoaderCircle size={15} className="spin" /> Loading verified preview…
      </div>
    );
  if (state.error)
    return (
      <div className="artifact-preview-error">
        <AlertCircle size={14} />
        {state.error}
      </div>
    );
  if (kind === 'image')
    return (
      <div className={`artifact-preview-image ${expanded ? 'expanded' : ''}`}>
        <img src={state.url} alt={file.name} />
      </div>
    );
  if (kind === 'pdf')
    return (
      <iframe
        className={`artifact-preview-pdf ${expanded ? 'expanded' : ''}`}
        src={state.url}
        title={`Preview of ${file.name}`}
      />
    );
  return (
    <pre className={`artifact-preview-text ${expanded ? 'expanded' : ''}`}>
      {state.text}
      {state.text.length >= 12000 ? '\n… preview truncated; download the complete file.' : ''}
    </pre>
  );
}
function ArtifactCard({ file, expanded = false, onPreview }) {
  const Icon = artifactIcon(file);
  const [downloadError, setDownloadError] = useState('');
  const onDownload = async () => {
    setDownloadError('');
    try {
      await downloadArtifact(file);
    } catch (error) {
      setDownloadError(error.message || 'Download failed.');
    }
  };
  return (
    <div className={`artifact-card ${expanded ? 'expanded' : ''}`}>
      <div className="artifact-card-head">
        <div className="library-file-icon">
          <Icon size={16} />
        </div>
        <div className="artifact-card-meta">
          <b title={file.name}>{file.name}</b>
          <small>
            {formatBytes(file.size)} · {file.mimeType || 'file'}
            {file.createdAt ? ` · ${dateLabel(file.createdAt)}` : ''}
          </small>
        </div>
        <div className="artifact-card-actions">
          {onPreview && (
            <button className="library-action" onClick={() => onPreview(file)} title="Open preview">
              <Eye size={14} />
            </button>
          )}
          <button className="library-action" onClick={onDownload} title="Download verified file">
            <Download size={14} />
          </button>
        </div>
      </div>
      {downloadError && (
        <div className="artifact-preview-error">
          <AlertCircle size={13} />
          {downloadError}
        </div>
      )}
      <ArtifactPreview file={file} expanded={expanded} />
    </div>
  );
}
function humanizeField(name = '') {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\b(id|url|api|npm|html|css|js|json)\b/gi, (part) => part.toUpperCase())
    .replace(/^./, (part) => part.toUpperCase());
}

function toolUsageSentence(event = {}) {
  const args = event.arguments && typeof event.arguments === 'object' ? event.arguments : {};
  const result = event.result && typeof event.result === 'object' ? event.result : {};
  const quote = (value, limit = 150) => {
    const text = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    const clipped = text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    return `“${clipped}”`;
  };
  const task = args.task_title || args.title || args.task_id;
  const context = args.task_context || args.description || args.objective;
  const running = event.status === 'running';
  let sentence = '';
  switch (event.name) {
    case 'execute_python': {
      const target = args.task_title || context || 'the requested step';
      sentence = `${running ? 'Running' : 'Ran'} Python for ${quote(target, 110)}.`;
      if (args.task_id) sentence += ` Task ${args.task_id}.`;
      if (Number(args.code_bytes) > 0)
        sentence += ` ${Number(args.code_bytes).toLocaleString()} bytes.`;
      if (Array.isArray(result.artifacts) && result.artifacts.length) {
        const archives = result.artifacts.filter((file) => /\.zip$/i.test(String(file.name || '')));
        const delivered = archives.length ? archives : result.artifacts;
        sentence += ` Created ${delivered.length === 1 ? '' : `${delivered.length} `}file${delivered.length === 1 ? '' : 's'}: ${delivered
          .map((file) => file.name)
          .filter(Boolean)
          .slice(0, 2)
          .join(', ')}.`;
      } else if (result.status) sentence += ` Execution status: ${result.status}.`;
      break;
    }
    case 'create_task_plan': {
      const objective = args.objective || result.plan?.objective;
      const count = Array.isArray(args.tasks)
        ? args.tasks.length
        : Array.isArray(result.plan?.tasks)
          ? result.plan.tasks.length
          : 0;
      sentence = objective
        ? `${running ? 'Creating' : 'Created'} a plan for ${quote(objective)}${count ? ` with ${count} steps` : ''}.`
        : `${running ? 'Creating' : 'Created'} an execution plan${count ? ` with ${count} steps` : ''}.`;
      break;
    }
    case 'update_task_status': {
      const status = String(args.status || result.task?.status || 'updated').replaceAll('_', ' ');
      sentence = task
        ? `${running ? 'Updating' : 'Updated'} ${quote(task)}${args.task_id ? ` (task ${args.task_id})` : ''} to ${status}.`
        : `${running ? 'Updating' : 'Updated'} task ${quote(args.task_id || 'record')} to ${status}.`;
      if (args.objective) sentence += ` Objective: ${quote(args.objective, 120)}.`;
      if (args.task_description)
        sentence += ` ${String(args.task_description).replace(/\s+/g, ' ').trim()}`;
      const note = args.note || result.task?.note;
      if (note) sentence += ` Note: ${String(note).replace(/\s+/g, ' ').trim()}`;
      break;
    }
    case 'web_search': {
      const query = args.query || args.search_query || args.q || args.search_terms;
      const count = Array.isArray(result.results) ? result.results.length : 0;
      sentence = query
        ? `${running ? 'Searching' : 'Searched'} the web for ${quote(query)}${count ? ` and found ${count} results` : ''}.`
        : `${running ? 'Searching' : 'Completed'} the web.`;
      break;
    }
    case 'fetch_public_url': {
      const url = args.url || args.uri || result.url;
      const bytes = typeof result.content === 'string' ? result.content.length : 0;
      sentence = url
        ? `${running ? 'Fetching' : 'Fetched'} ${quote(url, 180)}${bytes ? ` and received ${bytes.toLocaleString()} characters` : ''}.`
        : `${running ? 'Fetching' : 'Fetched'} a public webpage.`;
      break;
    }
    case 'generate_image':
      sentence = args.prompt
        ? `${running ? 'Generating' : 'Generated'} an image from ${quote(args.prompt)}.`
        : `${running ? 'Generating' : 'Generated'} an image.`;
      if (Array.isArray(result.artifacts) && result.artifacts.length)
        sentence += ` Saved ${result.artifacts.length} image file${result.artifacts.length === 1 ? '' : 's'}.`;
      break;
    case 'calculator':
      sentence = args.expression
        ? `${running ? 'Calculating' : 'Calculated'} ${quote(args.expression)}${result.result !== undefined ? ` and got ${result.result}` : ''}.`
        : `${running ? 'Calculating' : 'Completed'} a calculation.`;
      break;
    case 'github_search':
    case 'npm_search':
    case 'search_memories':
      sentence = args.query
        ? `Searched ${event.name === 'github_search' ? 'GitHub' : event.name === 'npm_search' ? 'npm' : 'saved memories'} for ${quote(args.query)}.`
        : `Searched ${humanizeField(event.name)}.`;
      break;
    case 'save_memory':
      sentence = args.memory
        ? `Saved the requested memory: ${quote(args.memory)}.`
        : 'Saved a memory.';
      break;
    case 'get_current_datetime':
      sentence = `Retrieved the current date and time${args.timezone ? ` for ${args.timezone}` : ''}.`;
      break;
    case 'list_shared_links':
      sentence = 'Listed your active shared links.';
      break;
    case 'search_previous_chats':
      sentence = args.query
        ? `Searched previous chats for ${quote(args.query)}.`
        : 'Searched previous chats.';
      break;
    default: {
      const meaningful = Object.entries(args)
        .filter(
          ([key, value]) =>
            !['code', 'script', 'source', 'content'].includes(key) &&
            value !== undefined &&
            value !== null &&
            value !== ''
        )
        .slice(0, 2)
        .map(
          ([key, value]) =>
            `${humanizeField(key).toLowerCase()} ${quote(formatToolArgument(value), 90)}`
        );
      sentence = meaningful.length
        ? `${humanizeField(event.name || 'Tool')} used with ${meaningful.join(' and ')}.`
        : `${humanizeField(event.name || 'Tool')} completed.`;
    }
  }
  if (event.error)
    sentence += ` The operation reported: ${String(event.error).replace(/\s+/g, ' ').slice(0, 180)}`;
  return sentence;
}

function formatToolArgument(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = '[complex value]';
    }
    return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
  }
  return String(value);
}

function ToolUsageInline({ events = [] }) {
  if (!events.length) return null;
  const grouped = [
    ...events
      .reduce((map, event) => {
        const key = `${event.name}:${event.status === 'error' ? 'error' : 'used'}`;
        const current = map.get(key) || { name: event.name, status: event.status, events: [] };
        current.events.push(event);
        map.set(key, current);
        return map;
      }, new Map())
      .values(),
  ];
  return (
    <div className="tool-usage-inline" aria-label="Tool activity">
      {grouped.map((group) => {
        const Icon = toolUsageIcon(group.name);
        const label =
          group.events.length === 1
            ? toolUsageSentence(group.events[0])
            : `${toolUsageSentence(group.events[0])} (${group.events.length} calls)`;
        return (
          <details
            className={`tool-usage-item ${group.status || ''}`}
            key={`${group.name}-${group.status}`}
          >
            <summary>
              <Icon className="tool-usage-summary-icon" size={12} aria-hidden="true" />
              <span className="tool-usage-summary-text">{label}</span>
            </summary>
            <div className="tool-usage-details">
              {group.events.map((event, index) => (
                <div className="tool-usage-detail-entry" key={`${group.name}-${index}`}>
                  <div className="tool-usage-call-title">{toolUsageSentence(event)}</div>
                  {event.error && <p className="tool-error">{event.error}</p>}
                  {event.arguments && (
                    <div className="tool-usage-fields">
                      <small>Details</small>
                      {Object.entries(event.arguments)
                        .filter(
                          ([key, value]) =>
                            !['code', 'script', 'source', 'content'].includes(key) &&
                            value !== undefined &&
                            value !== null &&
                            value !== ''
                        )
                        .map(([key, value]) => (
                          <div key={key}>
                            <b>{humanizeField(key)}</b>
                            <span>{formatToolArgument(value)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {event.result !== undefined && (
                    <div className="tool-usage-fields">
                      <small>Result</small>
                      {Object.entries(event.result || {})
                        .filter(
                          ([key, value]) =>
                            !['content', 'downloadUrl', 'data', 'buffer'].includes(key) &&
                            value !== undefined &&
                            value !== null &&
                            value !== ''
                        )
                        .slice(0, 12)
                        .map(([key, value]) => (
                          <div key={key}>
                            <b>{humanizeField(key)}</b>
                            <span>{formatToolArgument(value)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function InlineArtifact({ file }) {
  const [downloadError, setDownloadError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const Icon = artifactIcon(file);
  const onDownload = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDownloadError('');
    try {
      await downloadArtifact(file);
    } catch (error) {
      setDownloadError(error.message || 'Download failed.');
    }
  };
  return (
    <details className="artifact-inline" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>
        <Icon size={14} />
        <b title={file.name}>{file.name}</b>
        <small>{formatBytes(file.size)}</small>
        <span>Preview</span>
      </summary>
      {isOpen && (
        <div className="artifact-inline-body">
          <ArtifactPreview file={file} expanded />
          <button className="artifact-inline-download" onClick={onDownload}>
            <Download size={13} /> Download file
          </button>
          {downloadError && <p className="artifact-preview-error">{downloadError}</p>}
        </div>
      )}
    </details>
  );
}

function AgentPlanDock({ plan, onSave, disabled = false }) {
  const [draft, setDraft] = useState(plan);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(plan), [plan]);
  if (!plan?.tasks?.length) return null;
  const completed = plan.tasks.filter((task) =>
    ['completed', 'skipped'].includes(task.status)
  ).length;
  const changed = JSON.stringify(draft) !== JSON.stringify(plan);
  const updateTask = (taskId, patch) => {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    }));
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="agent-plan-dock" open>
      <summary>
        <ListChecks size={14} />
        <span>Execution plan</span>
        <small>
          {completed}/{plan.tasks.length} completed
        </small>
        <ChevronRight size={13} className="plan-chevron" />
      </summary>
      <div className="agent-plan-dock-body">
        <label className="plan-objective-label">Objective</label>
        <textarea
          value={draft?.objective || ''}
          disabled={disabled}
          rows={2}
          onChange={(event) =>
            setDraft((current) => ({ ...current, objective: event.target.value }))
          }
        />
        <div className="plan-edit-list">
          {(draft?.tasks || []).map((task) => (
            <div className={`plan-edit-task ${task.status || 'pending'}`} key={task.id}>
              <div className="plan-edit-task-state">
                {task.status === 'completed' ? (
                  <Check size={13} />
                ) : task.status === 'running' ? (
                  <LoaderCircle size={13} className="spin" />
                ) : task.status === 'failed' ? (
                  <AlertCircle size={13} />
                ) : (
                  <i />
                )}
              </div>
              <div className="plan-edit-fields">
                <input
                  value={task.title}
                  disabled={disabled}
                  onChange={(event) => updateTask(task.id, { title: event.target.value })}
                  aria-label={`Task ${task.id} title`}
                />
                <textarea
                  value={task.description || ''}
                  disabled={disabled}
                  rows={2}
                  onChange={(event) => updateTask(task.id, { description: event.target.value })}
                  aria-label={`Task ${task.id} description`}
                />
                <small>{(task.status || 'pending').replaceAll('_', ' ')}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="plan-dock-footer">
          <span>Changes are saved to this conversation.</span>
          <button disabled={disabled || saving || !changed} onClick={save}>
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    </details>
  );
}

function toolActivityMessage(name, args = {}) {
  const label = String(name || '').replaceAll('_', ' ');
  const path = args.path ? ` “${String(args.path).slice(0, 90)}”` : '';
  const query = args.query ? ` for “${String(args.query).slice(0, 70)}”` : '';
  const messages = {
    workspace_list: 'Inspecting the project files and folder structure.',
    workspace_read: `Reading${path} to understand the existing implementation.`,
    workspace_create: `Creating${path} in the project workspace.`,
    workspace_edit: `Updating${path} with the requested changes.`,
    workspace_delete: `Removing${path} from the project workspace.`,
    workspace_search: `Searching the project files${query}.`,
    workspace_status: 'Checking the current project workspace and file status.',
    workspace_archive: 'Packaging the completed project and validating the archive.',
    execute_python: 'Running the Python task in the isolated environment.',
    execute_node: 'Running the Node.js command in the isolated environment.',
    web_search: `Researching current information${query}.`,
    fetch_public_url: 'Opening the requested web page and extracting its content.',
    create_task_plan: 'Organizing the work into a structured execution plan.',
    update_task_status: 'Updating project milestone and task progress.',
    save_memory: 'Saving durable project context for future conversations.',
    search_memories: 'Checking saved context for relevant project decisions.',
    report_progress: 'Updating you on the current work.',
    generate_image: 'Generating the requested image.',
  };
  return messages[name] || `Running ${label || 'an agent operation'}.`;
}

function getSuggestedNextSteps(message) {
  const plan = message.agentPlan;
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const failed = tasks.filter((task) => task.status === 'failed');
  const pending = tasks.filter((task) => task.status === 'pending');
  const toolFailures = (message.toolEvents || []).filter((event) => event.status === 'error');
  if (failed.length || toolFailures.length) {
    return [
      { label: 'Investigate the blocker', prompt: 'Investigate the remaining failed task or tool error. Inspect the current files and diagnostics, fix the root cause, and verify the correction without repeating failed steps unchanged.' },
      { label: 'Review completed work', prompt: 'Summarize the completed work, current project state, and the exact remaining blockers.' },
    ];
  }
  if (pending.length) {
    return [
      { label: 'Continue the next task', prompt: 'Continue the existing project plan from the next pending task. Inspect the current workspace and persisted progress first, preserve completed work, and verify each task before marking it complete.' },
      { label: 'Review progress', prompt: 'Review the current project plan and completed milestones. Tell me what is done, what remains, and whether anything needs attention.' },
    ];
  }
  const hasArchive = (message.toolEvents || []).some((event) =>
    (event.result?.artifacts || []).some((artifact) => /\.zip$/i.test(String(artifact.name || '')))
  );
  if (hasArchive) {
    return [
      { label: 'Verify the deliverable', prompt: 'Perform a final verification of the generated project archive, its contents, and the project build/tests. Report any checks that cannot be run.' },
      { label: 'Explain how to run it', prompt: 'Give me the exact installation, configuration, and run/deployment steps for this project.' },
    ];
  }
  return [
    { label: 'Verify the result', prompt: 'Run the most relevant checks for the changes just completed. Inspect failures and report verified results separately from unverified work.' },
    { label: 'What should I do next?', prompt: 'Based on the result and current project state, recommend the most useful next step and explain why.' },
  ];
}

function LiveProgress({ progress, now, toolEvents = [] }) {
  const [toolsExpanded, setToolsExpanded] = useState(true);
  if (!progress) return null;
  const elapsed = (timestamp) => {
    const seconds = Math.max(0, Math.floor((now - (timestamp || now)) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  const isWorking = progress.type === 'working';
  const message = String(progress.message || 'Preparing the next agent action…');
  return (
    <div
      className={`live-progress${isWorking ? ' live-progress-working' : ''}`}
      role="status"
      aria-live="polite"
    >
      {isWorking ? (
        <LoaderCircle className="live-progress-working-icon spin" size={13} aria-hidden="true" />
      ) : (
        <span className="live-progress-orb">
          <i />
        </span>
      )}
      <div
        className="live-progress-message"
        role={toolEvents.length ? 'button' : undefined}
        tabIndex={toolEvents.length ? 0 : undefined}
        onClick={() => toolEvents.length && setToolsExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (toolEvents.length && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setToolsExpanded((value) => !value);
          }
        }}
        aria-expanded={toolEvents.length ? toolsExpanded : undefined}
        aria-label={
          toolEvents.length
            ? `${toolsExpanded ? 'Hide' : 'Show'} tool activity`
            : 'Current agent progress'
        }
        title={toolEvents.length ? 'Click to show or hide tool activity' : undefined}
      >
        {isWorking ? (
          <span>{message}</span>
        ) : (
          <span className="live-progress-typing" key={message}>
            <Markdown content={message} />
          </span>
        )}
      </div>
      {!isWorking && (
        <span
          className="live-progress-timing"
          aria-label={`Working ${elapsed(progress.startedAt)} · Last worked ${elapsed(progress.lastActivityAt)} ago`}
        >
          <span className="live-progress-timing-full">
            Working {elapsed(progress.startedAt)} · Last worked {elapsed(progress.lastActivityAt)}{' '}
            ago
          </span>
          <span className="live-progress-timing-compact">
            <Clock size={10} aria-hidden="true" />
            {elapsed(progress.startedAt)}
          </span>
        </span>
      )}
      {!!toolEvents.length && toolsExpanded && <ToolUsageInline events={toolEvents} />}
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div
      className={`toast toast-${toast.type || 'error'}`}
      role={toast.type === 'success' ? 'status' : 'alert'}
    >
      {toast.type === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}
      <span>{toast.message}</span>
      <button onClick={onClose} aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </div>
  );
}

function Message({
  message,
  onCopy,
  onEdit,
  onBranch,
  onShare,
  onRegenerate,
  onVersion,
  liveProgress,
  progressClock,
  thinking,
  onFollowup,
}) {
  const [editing, setEditing] = useState(false),
    [promptExpanded, setPromptExpanded] = useState(false),
    [editDraft, setEditDraft] = useState(textOf(message.content));
  const user = message.role === 'user',
    content = textOf(message.content),
    longPrompt = user && (content.length > 560 || content.split('\n').length > 7);
  const versions = message.versions || [];
  const activeVersion = Number.isInteger(message.activeVersion)
    ? message.activeVersion
    : Math.max(0, versions.length - 1);
  return (
    <article
      className={`message ${user ? 'user-message' : 'assistant-message'}`}
      data-message-id={message.id}
    >
      <div className={`message-avatar ${user ? 'user-avatar' : ''}`}>
        {user ? <UserRound size={15} /> : <Bot size={17} />}
      </div>
      <div className="message-main">
        <div className="message-heading">
          <span>{user ? 'You' : 'Assistant'}</span>
          {message.createdAt && <time>{dateLabel(message.createdAt)}</time>}
          {!user && message.model?.name && <span className="model-badge" title={message.routingDecision?.reason || message.model.id}>{message.model.name}{message.modelMode === 'auto' ? ' · Auto' : ''}</span>}
        </div>
        {!user && message.isStreaming && liveProgress && (
          <LiveProgress
            progress={liveProgress}
            now={progressClock}
            toolEvents={thinking ? message.toolEvents || [] : []}
          />
        )}
        {message.attachments?.length > 0 && (
          <div className="attachment-list">
            {message.attachments.map((f, i) => (
              <span className="attachment-pill" key={`${f.name}-${i}`}>
                {f.type?.startsWith('video') ? (
                  <Video size={13} />
                ) : f.type?.startsWith('image') ? (
                  <FileImage size={13} />
                ) : (
                  <FileText size={13} />
                )}{' '}
                {f.name}
              </span>
            ))}
          </div>
        )}
        {content &&
          (user ? (
            editing ? (
              <div className="inline-edit">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                />
                <div>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditDraft(content);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!editDraft.trim()}
                    onClick={() => {
                      setEditing(false);
                      onEdit(message, editDraft);
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className={`user-text${longPrompt && !promptExpanded ? ' prompt-collapsed' : ''}`}
                >
                  {content}
                </div>
                {longPrompt && (
                  <button
                    className="prompt-expand"
                    type="button"
                    onClick={() => setPromptExpanded((value) => !value)}
                  >
                    {promptExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )
          ) : (
            <Markdown content={content} />
          ))}
        {!user &&
          !message.isStreaming &&
          (() => {
            const generated = [
              ...new Map(
                (message.toolEvents || [])
                  .flatMap((event) => event.result?.artifacts || [])
                  .filter((file) => file?.id)
                  .map((file) => [file.id, file])
              ).values(),
            ];
            const archives = generated.filter((file) => /\.zip$/i.test(String(file.name || '')));
            const delivered = archives.length ? archives : generated;
            return delivered.length ? (
              <div className="message-inline-artifacts">
                {delivered.map((file) => (
                  <InlineArtifact key={file.id} file={file} />
                ))}
              </div>
            ) : null;
          })()}
        {message.error && (
          <div className="message-error" role="alert">
            <AlertCircle size={14} />
            {message.error}
          </div>
        )}
        {!user && !message.isStreaming && content.trim() && (
          <div className="message-actions">
            <button onClick={() => onShare(message)} title="Share response">
              <Share2 size={13} />
            </button>
            <button onClick={() => onRegenerate(message)} title="Regenerate response">
              <Sparkles size={13} />
            </button>
            {content && (
              <button title="Copy response" onClick={() => onCopy(content)}>
                <Copy size={13} />
              </button>
            )}
            <button onClick={() => onBranch(message)} title="Continue in new branch">
              <GitBranch size={13} />
            </button>
            {versions.length > 1 && (
              <span className="version-switch">
                <button
                  disabled={activeVersion <= 0}
                  onClick={() => onVersion(message, activeVersion - 1)}
                >
                  <ChevronLeft size={13} />
                </button>
                {activeVersion + 1}/{versions.length}
                <button
                  disabled={activeVersion >= versions.length - 1}
                  onClick={() => onVersion(message, activeVersion + 1)}
                >
                  <ChevronRight size={13} />
                </button>
              </span>
            )}
          </div>
        )}
        {!user && !message.isStreaming && content.trim() && onFollowup &&
          (message.agentPlan || message.toolEvents?.length > 0) && (
          <div className="next-step-suggestions" aria-label="Suggested next steps">
            <span className="next-step-heading"><Sparkles size={12} /> Suggested next steps</span>
            <div className="next-step-actions">
              {getSuggestedNextSteps(message).map((step) => (
                <button key={step.label} onClick={() => onFollowup(step.prompt)}>
                  {step.label}<ArrowUpRight size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        {user && content.trim() && (
          <div className="message-actions">
            <button
              onClick={() => {
                setEditDraft(content);
                setEditing(true);
              }}
              title="Edit message"
            >
              <PencilLine size={13} />
            </button>
            {content && (
              <button title="Copy response" onClick={() => onCopy(content)}>
                <Copy size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function LoginScreen({ providers, error, returnTo = '/' }) {
  const labels = {
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    discord: 'Continue with Discord',
  };
  const icons = { google: 'G', github: '⌘', discord: '◉' };
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand-mark large">✦</div>
        <p className="eyebrow">NEMOTRON AGENT LAB</p>
        <h1>
          Your workspace,
          <br />
          <em>your agent.</em>
        </h1>
        <p className="login-sub">
          Sign in or create an account to access your conversations, saved memories and personal
          preferences.
        </p>
        {error && <div className="notice error-notice">{error}</div>}
        <div className="oauth-list">
          {Object.keys(labels).map((provider) => (
            <a
              className={`oauth-button ${providers?.[provider] ? '' : 'disabled'}`}
              href={
                providers?.[provider]
                  ? api(`/api/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`)
                  : undefined
              }
              key={provider}
              onClick={(e) => !providers?.[provider] && e.preventDefault()}
            >
              <b>{icons[provider]}</b>
              {labels[provider]}
              {!providers?.[provider] && <small>Not configured</small>}
            </a>
          ))}
        </div>
        <p className="login-foot">
          <ShieldCheck size={13} /> Your account data is private and tied to your sign-in.
        </p>
      </div>
    </div>
  );
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function artifactIcon(file) {
  const mime = file.mimeType || '';
  if (mime.startsWith('image/')) return FileImage;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv')
    return FileSpreadsheet;
  if (mime.includes('zip') || mime.includes('compressed')) return FileArchive;
  return FileText;
}
function FileLibraryDialog({ open, onClose, refreshKey = 0 }) {
  const [files, setFiles] = useState([]),
    [total, setTotal] = useState(0),
    [totalBytes, setTotalBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(50 * 1024 * 1024),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [previewFile, setPreviewFile] = useState(null);
  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    try {
      const response = await request('/api/interpreter/artifacts?limit=100');
      const data = await response.json();
      setFiles(data.files || []);
      setTotal(data.total || 0);
      setTotalBytes(data.totalBytes || 0);
      setQuotaBytes(data.quotaBytes || 50 * 1024 * 1024);
    } catch (err) {
      setError(err.message || 'Could not load your File Library.');
    } finally {
      setLoading(false);
    }
  }, [open]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  useEffect(() => {
    if (!open) setPreviewFile(null);
  }, [open]);
  if (!open) return null;
  const filtered = files.filter((file) =>
    `${file.name} ${file.mimeType} ${file.relativePath}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const remove = async (file) => {
    if (!window.confirm(`Delete ${file.name} from your File Library?`)) return;
    try {
      await request(`/api/interpreter/artifacts/${encodeURIComponent(file.id)}`, {
        method: 'DELETE',
      });
      if (previewFile?.id === file.id) setPreviewFile(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete file.');
    }
  };
  const handleDownload = async (file) => {
    setError('');
    try {
      await downloadArtifact(file);
    } catch (err) {
      setError(err.message || 'Download failed.');
    }
  };
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <section className="file-library-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>
              <Files size={19} /> File Library
            </h2>
            <p>Files generated by Python across your conversations.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close File Library">
            <X size={17} />
          </button>
        </div>
        <div className="library-summary">
          <div>
            <b>{total}</b>
            <span>saved files</span>
          </div>
          <div>
            <b>{formatBytes(totalBytes)}</b>
            <span>of {formatBytes(quotaBytes)} used</span>
          </div>
          <button className="secondary-button compact" onClick={load} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
        <div className="library-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files by name or type…"
          />
          <span>{filtered.length}</span>
        </div>
        {error && <div className="notice error-notice">{error}</div>}
        <div className="library-list">
          {loading && !files.length ? (
            <div className="library-skeleton-list">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="library-skeleton-row" key={index}>
                  <Skeleton width={34} height={34} />
                  <span>
                    <Skeleton width="55%" height={11} />
                    <Skeleton width="34%" height={8} />
                  </span>
                </div>
              ))}
            </div>
          ) : filtered.length ? (
            filtered.map((file) => {
              const Icon = artifactIcon(file);
              return (
                <div className="library-file" key={file.id}>
                  <div className="library-file-icon">
                    <Icon size={17} />
                  </div>
                  <div className="library-file-info">
                    <b title={file.name}>{file.name}</b>
                    <small>
                      {formatBytes(file.size)} · {dateLabel(file.createdAt)}
                      {file.relativePath && file.relativePath !== file.name
                        ? ` · ${file.relativePath}`
                        : ''}
                    </small>
                  </div>
                  <div className="library-file-actions">
                    <button
                      className="library-action"
                      onClick={() => setPreviewFile(file)}
                      title="View file"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      className="library-action"
                      onClick={() => handleDownload(file)}
                      title="Download file"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      className="library-action danger"
                      onClick={() => remove(file)}
                      title="Delete file"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="library-empty">
              <HardDrive size={24} />
              <b>{search ? 'No matching files' : 'Your File Library is empty'}</b>
              <span>
                {search
                  ? 'Try another search term.'
                  : 'Ask Nemotron to create a spreadsheet, PDF, chart, image or other file. Generated files will appear here.'}
              </span>
            </div>
          )}
        </div>
        <div className="library-footer">
          <span>Files are private to your account and remain until you delete them.</span>
          <button className="secondary-button compact" onClick={onClose}>
            Close
          </button>
        </div>
        {previewFile && (
          <div
            className="artifact-preview-layer"
            onMouseDown={(event) => {
              event.stopPropagation();
              setPreviewFile(null);
            }}
          >
            <section
              className="artifact-preview-dialog"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="modal-head">
                <div>
                  <div className="eyebrow">FILE PREVIEW</div>
                  <h2>{previewFile.name}</h2>
                  <p>
                    {formatBytes(previewFile.size)} · {previewFile.mimeType}
                  </p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setPreviewFile(null)}
                  aria-label="Close preview"
                >
                  <X size={17} />
                </button>
              </div>
              <ArtifactCard file={previewFile} expanded />
              <div className="artifact-preview-dialog-actions">
                <button
                  className="secondary-button compact"
                  onClick={() => handleDownload(previewFile)}
                >
                  <Download size={13} /> Download original
                </button>
                <button className="secondary-button compact" onClick={() => setPreviewFile(null)}>
                  Close
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function Skeleton({ width = '100%', height = 12, radius = 8, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

function StatusPage({
  code = '500',
  title = 'Something went wrong',
  message = 'The workspace could not complete this request.',
  actionLabel = 'Try again',
  onAction,
}) {
  return (
    <main className="status-page">
      <div className="status-card">
        <div className="brand-mark large">✦</div>
        <div className="status-code">{code}</div>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="status-actions">
          {onAction && (
            <button className="primary-button" onClick={onAction}>
              {actionLabel}
            </button>
          )}
          <a className="secondary-button" href="/">
            Go to workspace
          </a>
        </div>
      </div>
    </main>
  );
}

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error('Application render failed:', error);
  }
  render() {
    if (this.state.error)
      return (
        <StatusPage
          code="500"
          title="The app hit an unexpected error"
          message="Your saved conversations are safe. Reload the page to try again."
          actionLabel="Reload"
          onAction={() => location.reload()}
        />
      );
    return this.props.children;
  }
}

function WorkspaceSkeleton() {
  return (
    <div className="workspace-skeleton" aria-label="Loading workspace">
      <div className="skeleton-head">
        <Skeleton width="34%" height={15} />
        <Skeleton width="18%" height={28} />
      </div>
      <div className="skeleton-conversation">
        <Skeleton width="68%" height={58} />
        <Skeleton width="84%" height={86} />
        <Skeleton width="54%" height={52} />
      </div>
      <div className="skeleton-composer">
        <Skeleton width="100%" height={64} />
      </div>
    </div>
  );
}

function HistoryDrawer({
  open,
  onClose,
  chats,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onChatMeta,
  onOpenLibrary,
  deletingChatIds = new Set(),
  chatsLoaded = true,
}) {
  const [folderFilter, setFolderFilter] = useState('');
  if (!open) return null;
  const visibleChats = (() => {
    if (folderFilter === '__pinned__') return chats.filter((chat) => chat.pinned);
    if (folderFilter) return chats.filter((chat) => chat.folder === folderFilter);
    return chats;
  })();
  return (
    <div className="drawer-layer" onMouseDown={onClose}>
      <aside className="history-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <b>Conversations</b>
            <small>{chats.length} saved</small>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <button className="new-chat-button" onClick={onNew}>
          <Plus size={15} /> New conversation
        </button>
        <button className="library-nav-button" onClick={onOpenLibrary}>
          <Files size={15} /> File Library <span>Generated files</span>
        </button>
        <div className="drawer-filters">
          <button
            className={folderFilter === '__pinned__' ? 'selected' : ''}
            onClick={() => setFolderFilter(folderFilter === '__pinned__' ? '' : '__pinned__')}
          >
            <Star size={12} /> Pinned
          </button>
          {[...new Set(chats.map((chat) => chat.folder).filter(Boolean))].map((folder) => (
            <button
              key={folder}
              className={folderFilter === folder ? 'selected' : ''}
              onClick={() => setFolderFilter(folderFilter === folder ? '' : folder)}
            >
              <Folder size={12} /> {folder}
            </button>
          ))}
        </div>
        <div className="history-list">
          {!chatsLoaded ? (
            <div className="history-skeleton">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index}>
                  <Skeleton width={22} height={22} />
                  <span>
                    <Skeleton width="68%" height={10} />
                    <Skeleton width="35%" height={7} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            visibleChats.map((chat) => (
              <div
                className={`history-item ${chat._id === activeId ? 'active' : ''} ${deletingChatIds.has(chat._id) ? 'deleting' : ''}`}
                key={chat._id}
              >
                <button
                  className="history-select"
                  disabled={deletingChatIds.has(chat._id)}
                  onClick={() => onSelect(chat._id)}
                >
                  <MessageSquare size={15} />
                  <span>
                    <b>
                      {chat.pinned ? <Pin size={11} className="pin-flag" /> : null}
                      {chat.title || 'New chat'}
                    </b>
                    <small>
                      {dateLabel(chat.updatedAt)}
                      {chat.folder ? ` · ${chat.folder}` : ''}
                      {chat.tags?.length ? ` · ${chat.tags.join(', ')}` : ''}
                    </small>
                  </span>
                </button>
                <button
                  className="delete-chat"
                  disabled={deletingChatIds.has(chat._id)}
                  onClick={() => onChatMeta(chat)}
                  title="Pin, folder & tags"
                >
                  <FolderCog size={13} />
                </button>
                <button
                  className="delete-chat"
                  disabled={deletingChatIds.has(chat._id)}
                  onClick={() => onRename(chat)}
                  title="Rename"
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="delete-chat"
                  disabled={deletingChatIds.has(chat._id)}
                  onClick={() => onDelete(chat._id)}
                  title={deletingChatIds.has(chat._id) ? 'Deleting conversation' : 'Delete'}
                >
                  {deletingChatIds.has(chat._id) ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            ))
          )}
          {chatsLoaded && !chats.length && <p className="empty-history">No conversations yet.</p>}
        </div>
      </aside>
    </div>
  );
}
function UsageDashboard({ request }) {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setError(false);
    request(`/api/chats/usage?days=${range}`)
      .then((r) => r.json())
      .then((payload) => {
        if (alive) setData(payload.usage || null);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [range, request]);
  const totals = data?.totals || {};
  const daily = data?.daily || [];
  const maxTokens = Math.max(1, ...daily.map((d) => d.totalTokens || 0));
  const cards = [
    { label: 'Conversations', value: totals.chats },
    { label: 'Your messages', value: totals.userMessages },
    { label: 'Replies', value: totals.assistantMessages },
    { label: 'Tool calls', value: totals.toolCalls },
    { label: 'Input tokens', value: totals.promptTokens },
    { label: 'Output tokens', value: totals.completionTokens },
    { label: 'Total tokens', value: totals.totalTokens },
    { label: 'Responses measured', value: totals.requestsWithUsage },
    {
      label: 'Avg response',
      value: totals.avgResponseMs ? `${(totals.avgResponseMs / 1000).toFixed(1)}s` : '—',
    },
  ];
  return (
    <div className="usage-dashboard">
      <div className="usage-range">
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            className={range === days ? 'selected' : ''}
            onClick={() => setRange(days)}
          >
            {days}d
          </button>
        ))}
      </div>
      {error ? (
        <div className="empty-history">Could not load usage right now.</div>
      ) : !data ? (
        <div className="usage-skeleton">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} width="100%" height={54} />
          ))}
        </div>
      ) : (
        <>
          <div className="usage-cards">
            {cards.map((card) => (
              <div className="usage-card" key={card.label}>
                <small>{card.label}</small>
                <b>{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</b>
              </div>
            ))}
          </div>
          <div className="usage-chart" aria-label="Tokens per day">
            {daily.length ? (
              daily.map((day) => (
                <div
                  key={day.date}
                  className="usage-bar"
                  title={`${day.date}: ${(day.totalTokens || 0).toLocaleString()} tokens`}
                  style={{ height: `${Math.max(4, ((day.totalTokens || 0) / maxTokens) * 100)}%` }}
                />
              ))
            ) : (
              <div className="empty-history">No activity in this period.</div>
            )}
          </div>
          <div className="usage-model-breakdown">
            <b>Model usage</b>
            {Object.entries(data.modelUsage || {}).length ? Object.entries(data.modelUsage).map(([alias, item]) => (
              <div className="usage-model-row" key={alias}><span>{alias.charAt(0).toUpperCase() + alias.slice(1)} <small>{item.requests} request{item.requests === 1 ? '' : 's'}</small></span><b>{Number(item.totalTokens || 0).toLocaleString()} tokens</b></div>
            )) : <div className="empty-history">No model usage metadata recorded for this period.</div>}
          </div>
          <small className="usage-footnote">
            {daily.length} active day{daily.length === 1 ? '' : 's'} · measured token counts come from NVIDIA response usage metadata. {totals.legacyUsageMessages ? ` ${totals.legacyUsageMessages} response(s) from older releases may undercount multi-round token usage.` : ''}{totals.missingUsageMessages ? ` ${totals.missingUsageMessages} response(s) have no usage metadata.` : ''}
          </small>
        </>
      )}
    </div>
  );
}
function ChatMetaDialog({ chat, onClose, onSave }) {
  const [pinned, setPinned] = useState(Boolean(chat?.pinned));
  const [folder, setFolder] = useState(chat?.folder || '');
  const [tags, setTags] = useState((chat?.tags || []).join(', '));
  if (!chat) return null;
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div className="chat-meta-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <b>Organise conversation</b>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="meta-row">
          <span>Pin to top</span>
          <Toggle label="" value={pinned} onChange={setPinned} />
        </label>
        <label className="meta-row">
          <span>Folder</span>
          <input
            value={folder}
            maxLength={60}
            placeholder="e.g. Work"
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        <label className="meta-row">
          <span>Tags (comma-separated)</span>
          <input
            value={tags}
            placeholder="draft, urgent"
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button compact" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button compact"
            onClick={() =>
              onSave(chat._id, {
                pinned,
                folder: folder.trim(),
                tags: tags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 12),
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
function buildPersonalityPreview(values = {}) {
  const value = (key, fallback = 50) => Number(values[key] ?? fallback);
  const choose = (v, low, mid, high) => v < 34 ? low : v > 66 ? high : mid;
  const tone = `${choose(value('professionalism', 80), 'casual', 'balanced', 'professional')} and ${choose(value('friendliness', 75), 'reserved', 'approachable', 'warm')}`;
  const communication = `${choose(value('directness', 75), 'gentle', 'clear', 'direct')}, ${choose(value('explanatoryDepth', 65), 'concise', 'well-explained', 'detailed')}${value('humor', 35) > 66 ? ', with a playful sense of humor' : value('humor', 35) < 34 ? ', with a serious tone' : ''}`;
  const thinking = `${choose(value('criticalThinking', 90), 'open-minded', 'thoughtful', 'strongly critical')} and ${choose(value('creativity', 70), 'practical', 'adaptable', 'creative')}, with ${choose(value('analyticalDepth', 85), 'high-level', 'balanced', 'deep')} analysis`;
  const behavior = `${choose(value('autonomy', 75), 'instruction-led', 'self-directed', 'proactive within permissions')}, ${choose(value('initiative', 80), 'reactive', 'engaged', 'initiative-taking')}, and ${choose(value('thoroughness', 85), 'efficient', 'careful', 'meticulous')}`;
  const baseStyle = values.baseStyle || 'friendly';
  const baseTone = values.tone || 'balanced';
  const warmth = Number(values.warmth ?? 3);
  const enthusiasm = Number(values.enthusiasm ?? 3);
  const emoji = values.emoji || 'moderate';
  const formatting = `${values.visualAnswers === false ? 'visuals only when requested' : 'visuals when useful'}, ${values.headers === false ? 'minimal headings' : 'helpful headings'}, and ${values.lists === false ? 'prose-first formatting' : 'helpful lists'}`;
  return `Nemi communicates in a ${tone} manner with a ${baseStyle} style and ${baseTone} tone: ${communication}. It approaches problems with ${thinking}. Its working style is ${behavior}. It maintains ${choose(value('empathy', 70), 'objective', 'considerate', 'empathetic')} interactions and ${choose(value('confidence', 80), 'cautious', 'measured', 'confident')} recommendations. Risk preference is ${choose(value('riskTolerance', 35), 'conservative', 'balanced', 'experimental')}. Warmth ${warmth}/5, enthusiasm ${enthusiasm}/5, ${emoji} emoji use; ${formatting}. Personality traits are expressed at ${value('intensity', 70)}% intensity.`;
}

function PreferencesDialog({
  open,
  onClose,
  preferences,
  setPreferences,
  memories,
  addMemory,
  editMemory,
  deleteMemory,
  user,
  logout,
  saveProfile,
  linkProvider,
  shares,
  loadShares,
  sharesLoading = false,
  revokeShare,
  providers,
  accountResourcesLoading = false,
  theme,
  setTheme,
}) {
  const [tab, setTab] = useState('profile'),
    [draft, setDraft] = useState(''),
    [editing, setEditing] = useState(null),
    [displayName, setDisplayName] = useState(user?.name || ''),
    [username, setUsername] = useState(user?.username || ''),
    [usernameState, setUsernameState] = useState('idle'),
    [profileError, setProfileError] = useState('');
  const [pluginPermissions, setPluginPermissions] = useState({}),
    [customTools, setCustomTools] = useState([]),
    [pluginsLoading, setPluginsLoading] = useState(false),
    [toolDraft, setToolDraft] = useState(null);
  const [developerUnlocked, setDeveloperUnlocked] = useState(() => { try { return localStorage.getItem('nemotron.developerMode') === 'unlocked'; } catch { return false; } });
  const [settingsTitleClicks, setSettingsTitleClicks] = useState(0);
  const [integrations, setIntegrations] = useState({});
  const [integrationDrafts, setIntegrationDrafts] = useState({ nvidia: {}, tavily: {}, cloudflare: {}, vercel: {} });
  const [integrationBusy, setIntegrationBusy] = useState('');
  const [integrationMessage, setIntegrationMessage] = useState('');
  const [personaDraft, setPersonaDraft] = useState(preferences.personaInstructions || '');
  const defaultPersonality = DEFAULT_PREFERENCES.personality;
  const [personalityDraft, setPersonalityDraft] = useState({ ...defaultPersonality, ...(preferences.personality || {}) });
  const [personalityProfiles, setPersonalityProfiles] = useState([]);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [personalityMessage, setPersonalityMessage] = useState('');
  const usernameValid = /^[a-z0-9_]{3,24}$/.test(username);
  useEffect(() => {
    setPersonaDraft(preferences.personaInstructions || '');
  }, [preferences.personaInstructions, open]);
  useEffect(() => {
    if (!open || personaDraft === (preferences.personaInstructions || '')) return undefined;
    const timer = setTimeout(() => update('personaInstructions', personaDraft), 550);
    return () => clearTimeout(timer);
  }, [personaDraft, open, preferences.personaInstructions]);
  useEffect(() => {
    if (!open) return;
    setPersonalityDraft({ ...defaultPersonality, ...(preferences.personality || {}) });
    try {
      const saved = JSON.parse(localStorage.getItem('nemotron.personalityProfiles') || '[]');
      setPersonalityProfiles(Array.isArray(saved) ? saved.slice(0, 12) : []);
    } catch { setPersonalityProfiles([]); }
  }, [open]);
  useEffect(() => {
    if (!open || JSON.stringify(personalityDraft) === JSON.stringify({ ...defaultPersonality, ...(preferences.personality || {}) })) return undefined;
    const timer = setTimeout(() => setPreferences((current) => ({ ...current, personality: personalityDraft })), 450);
    return () => clearTimeout(timer);
  }, [personalityDraft, open]);
  useEffect(() => {
    if (open) {
      setTab('profile');
      loadShares();
      setDraft('');
      setEditing(null);
      setDisplayName(user?.name || '');
      setUsername(user?.username || '');
      setProfileError('');
    }
  }, [open, user?.name, user?.username]);
  useEffect(() => {
    if (!open || !username || username === user?.username) {
      setUsernameState('idle');
      return;
    }
    let cancelled = false;
    setUsernameState('checking');
    const timer = setTimeout(async () => {
      try {
        const response = await request(
          `/api/account/profile/username-availability?username=${encodeURIComponent(username)}`
        );
        const data = await response.json();
        if (!cancelled) setUsernameState(data.available ? 'available' : 'taken');
      } catch {
        if (!cancelled) setUsernameState('idle');
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, open, user?.username]);
  const loadIntegrations = async () => {
    const response = await request('/api/account/integrations');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load integrations.');
    setIntegrations(payload.integrations || {});
  };
  const saveIntegration = async (provider) => {
    setIntegrationBusy(`${provider}:save`); setIntegrationMessage('');
    try {
      const response = await request(`/api/account/integrations/${provider}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(integrationDrafts[provider] || {}) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save integration.');
      setIntegrationDrafts((current) => ({ ...current, [provider]: {} }));
      await loadIntegrations(); setIntegrationMessage(`${provider} credentials saved securely.`);
    } catch (error) { setIntegrationMessage(error.message); }
    finally { setIntegrationBusy(''); }
  };
  const testIntegration = async (provider) => {
    setIntegrationBusy(`${provider}:test`); setIntegrationMessage('');
    try {
      const response = await request(`/api/account/integrations/${provider}/test`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Connection test failed.');
      setIntegrationMessage(payload.message || 'Connection verified.');
    } catch (error) { setIntegrationMessage(error.message); }
    finally { setIntegrationBusy(''); }
  };
  const removeIntegration = async (provider) => {
    setIntegrationBusy(`${provider}:remove`); setIntegrationMessage('');
    try {
      const response = await request(`/api/account/integrations/${provider}`, { method: 'DELETE' });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not remove integration.');
      await loadIntegrations(); setIntegrationMessage(`${provider} credentials removed.`);
    } catch (error) { setIntegrationMessage(error.message); }
    finally { setIntegrationBusy(''); }
  };
  const unlockDeveloperMode = () => {
    const next = settingsTitleClicks + 1; setSettingsTitleClicks(next);
    if (next >= 7) {
      setDeveloperUnlocked(true); setTab('developer'); setSettingsTitleClicks(0);
      try { localStorage.setItem('nemotron.developerMode', 'unlocked'); } catch {}
      loadIntegrations().catch((error) => setIntegrationMessage(error.message));
    }
  };
  if (!open) return null;
  const update = (key, value) => setPreferences((p) => ({ ...p, [key]: value }));
  const saveMemory = async () => {
    if (!draft.trim()) return;
    if (editing) await editMemory(editing, draft.trim());
    else await addMemory(draft.trim());
    setDraft('');
    setEditing(null);
  };
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <section className="preferences-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="eyebrow">YOUR ACCOUNT</div>
            <h2 onClick={unlockDeveloperMode} title={developerUnlocked ? 'Developer Mode enabled' : undefined}>Personalization</h2>
            <p>Shape how your assistant communicates and remembers context.</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="account-strip">
          {user?.avatar ? (
            <img
              src={user.avatar}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
              alt=""
            />
          ) : (
            <span className="account-avatar-fallback">
              <UserRound size={15} />
            </span>
          )}
          <div>
            <b>{user?.name || 'Account'}</b>
            <small>{user?.email || user?.provider}</small>
          </div>
          <button className="secondary-button compact" onClick={logout}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
        <div className="tab-row">
          <button className={tab === 'profile' ? 'selected' : ''} onClick={() => setTab('profile')}>
            <UserRound size={14} /> Profile
          </button>
          <button
            className={tab === 'personalization' ? 'selected' : ''}
            onClick={() => setTab('personalization')}
          >
            <SlidersHorizontal size={14} /> Personalization
          </button>
          <button
            className={tab === 'memories' ? 'selected' : ''}
            onClick={() => setTab('memories')}
          >
            <Brain size={14} /> Manage memory <span>{memories.length}</span>
          </button>
          <button
            className={tab === 'shares' ? 'selected' : ''}
            onClick={() => {
              setTab('shares');
              loadShares();
            }}
          >
            <Share2 size={14} /> Shared links <span>{shares.length}</span>
          </button>
          <button
            className={tab === 'plugins' ? 'selected' : ''}
            onClick={() => {
              setTab('plugins');
              if (!user || String(user._id || '').startsWith('guest:')) return;
              setPluginsLoading(true);
              request('/api/account/plugins')
                .then((r) => r.json())
                .then((data) => {
                  setPluginPermissions(data.permissions || {});
                  setCustomTools(data.customTools || []);
                })
                .catch(() => {})
                .finally(() => setPluginsLoading(false));
            }}
          >
            <Puzzle size={14} /> Tools & plugins
          </button>
          <button className={tab === 'usage' ? 'selected' : ''} onClick={() => setTab('usage')}>
            <BarChart3 size={14} /> Usage
          </button>
          {developerUnlocked && (
            <button className={tab === 'developer' ? 'selected' : ''} onClick={() => { setTab('developer'); loadIntegrations().catch((error) => setIntegrationMessage(error.message)); }}>
              <Wrench size={14} /> Developer
            </button>
          )}
        </div>
        {tab === 'developer' && developerUnlocked ? (
          <div className="developer-settings">
            <div className="memory-intro">
              <b>Developer Mode</b>
              <p>Configure personal credentials for Nemotron and the services used by agent tools. Secrets are encrypted by the backend and never returned to this page.</p>
            </div>
            {integrationMessage && <div className="notice">{integrationMessage}</div>}
            {Object.values(integrations).some((item) => item?.error) && <div className="notice error-notice">One or more saved credentials could not be decrypted. Re-enter the affected credentials. Verify that USER_INTEGRATIONS_ENCRYPTION_KEY has not changed.</div>}
            {[
              { id: 'nvidia', name: 'NVIDIA NIM', description: 'Personal NVIDIA API key for all Nemotron models.', fields: [{ id: 'apiKey', label: 'NVIDIA API key', secret: true }] },
              { id: 'tavily', name: 'Tavily Search', description: 'Personal Tavily key for web research.', fields: [{ id: 'apiKey', label: 'Tavily API key', secret: true }] },
              { id: 'cloudflare', name: 'Cloudflare Workers AI', description: 'Image generation through your Cloudflare account.', fields: [{ id: 'accountId', label: 'Cloudflare account ID' }, { id: 'apiToken', label: 'Cloudflare API token', secret: true }] },
              { id: 'vercel', name: 'Vercel Sandbox', description: 'Personal sandbox authentication. The deployment still needs an approved Node sandbox image to enable Node.js execution.', fields: [{ id: 'token', label: 'Vercel access token', secret: true }, { id: 'teamId', label: 'Vercel team ID' }, { id: 'projectId', label: 'Vercel project ID' }] },
            ].map((provider) => (
              <section className="integration-card" key={provider.id}>
                <div className="integration-card-head">
                  <div><b>{provider.name}</b><small>{provider.description}</small></div>
                  <span className={`integration-status ${integrations[provider.id]?.configured ? 'configured' : ''}`}>{integrations[provider.id]?.error ? 'Credential error' : integrations[provider.id]?.configured ? 'Personal key saved' : 'Not configured'}</span>
                </div>
                <div className="integration-fields">
                  {provider.fields.map((field) => (
                    <label key={field.id}>{field.label}
                      <input type={field.secret ? 'password' : 'text'} autoComplete="off" value={integrationDrafts[provider.id]?.[field.id] || ''} placeholder={integrations[provider.id]?.fields?.[field.id] ? `Saved ${integrations[provider.id].fields[field.id]} · enter to replace` : `Enter ${field.label}`} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [provider.id]: { ...current[provider.id], [field.id]: event.target.value } }))} />
                    </label>
                  ))}
                </div>
                <div className="integration-actions">
                  <button className="primary-button compact" disabled={Boolean(integrationBusy)} onClick={() => saveIntegration(provider.id)}>{integrationBusy === `${provider.id}:save` ? 'Saving…' : 'Save credentials'}</button>
                  <button className="secondary-button compact" disabled={!integrations[provider.id]?.configured || Boolean(integrationBusy)} onClick={() => testIntegration(provider.id)}>{integrationBusy === `${provider.id}:test` ? 'Testing…' : 'Test connection'}</button>
                  <button className="tiny-action danger-text" disabled={!integrations[provider.id]?.configured || Boolean(integrationBusy)} onClick={() => removeIntegration(provider.id)}>Remove</button>
                </div>
              </section>
            ))}
            <div className="developer-note"><b>Credential priority</b><p>Personal credentials are used when configured. Otherwise the application can use its platform credentials. If your personal provider returns a quota or authentication error, the agent will report it rather than silently spending the platform key.</p></div>
            <button className="secondary-button compact" onClick={() => { setDeveloperUnlocked(false); setTab('profile'); try { localStorage.removeItem('nemotron.developerMode'); } catch {} }}>Disable Developer Mode</button>
          </div>
        ) : tab === 'shares' ? (
          <div className="shared-links">
            {sharesLoading ? (
              <div className="share-list-skeleton">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index}>
                    <Skeleton width="58%" height={11} />
                    <Skeleton width="24%" height={8} />
                  </div>
                ))}
              </div>
            ) : (
              shares.map((share) => (
                <div key={share.shareId}>
                  <span>
                    <b>{share.title}</b>
                    <small>
                      {share.shareType === 'chat' ? 'Full conversation' : 'Response snapshot'} ·{' '}
                      {dateLabel(share.createdAt)}
                    </small>
                  </span>
                  <a href={`/share/${share.shareId}`} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(`${location.origin}/share/${share.shareId}`)
                    }
                  >
                    Copy link
                  </button>
                  <button onClick={() => revokeShare(share.shareId)}>Revoke</button>
                </div>
              ))
            )}
            {!sharesLoading && !shares.length && (
              <p className="empty-history">No active shared links.</p>
            )}
          </div>
        ) : accountResourcesLoading ? (
          <div className="account-content-skeleton">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index}>
                <Skeleton width="32%" height={9} />
                <Skeleton width="100%" height={34} />
              </div>
            ))}
          </div>
        ) : tab === 'plugins' ? (
          <div className="plugin-manager">
            <div className="memory-intro">
              <b>Tool permissions</b>
              <p>
                Turn built-in tools off to stop the agent from calling them. Custom tools call your
                own https:// endpoints when the model decides to.
              </p>
            </div>
            {pluginsLoading ? (
              <div className="account-content-skeleton">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index}>
                    <Skeleton width="40%" height={9} />
                    <Skeleton width="100%" height={34} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="preference-toggles">
                {PLUGIN_CATALOG.map((plugin) => plugin.configurable ? (
                  <Toggle
                    key={plugin.id}
                    label={`${plugin.name} — ${plugin.description}`}
                    value={pluginPermissions[plugin.id] !== false}
                    onChange={(v) => {
                      const next = { ...pluginPermissions, [plugin.id]: v };
                      setPluginPermissions(next);
                      request('/api/account/plugins', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions: { [plugin.id]: v } }) }).catch(() => {});
                    }}
                  />
                ) : (
                  <div className="tool-default-row" key={plugin.id}><span><b>{plugin.name}</b><small>{plugin.description}</small></span><em>Always enabled</em></div>
                ))}
              </div>
            )}
            <div className="custom-tools-head">
              <b>Custom tools ({customTools.length})</b>
              <button
                className="secondary-button compact"
                onClick={() =>
                  setToolDraft({ name: '', url: '', description: '', method: 'POST', params: '' })
                }
              >
                <Plus size={13} /> Add tool
              </button>
            </div>
            {toolDraft && (
              <div className="custom-tool-form">
                <label>
                  Name
                  <input
                    value={toolDraft.name}
                    maxLength={60}
                    placeholder="Weather lookup"
                    onChange={(e) => setToolDraft({ ...toolDraft, name: e.target.value })}
                  />
                </label>
                <label>
                  Endpoint (https://)
                  <input
                    value={toolDraft.url}
                    placeholder="https://api.example.com/weather"
                    onChange={(e) => setToolDraft({ ...toolDraft, url: e.target.value })}
                  />
                </label>
                <label>
                  Description for the model
                  <input
                    value={toolDraft.description}
                    maxLength={400}
                    placeholder="Gets the current weather for a city"
                    onChange={(e) => setToolDraft({ ...toolDraft, description: e.target.value })}
                  />
                </label>
                <label>
                  Parameters (comma-separated names)
                  <input
                    value={toolDraft.params}
                    placeholder="city, units"
                    onChange={(e) => setToolDraft({ ...toolDraft, params: e.target.value })}
                  />
                </label>
                <label>
                  Method
                  <select
                    value={toolDraft.method}
                    onChange={(e) => setToolDraft({ ...toolDraft, method: e.target.value })}
                  >
                    <option value="POST">POST (JSON body)</option>
                    <option value="GET">GET (query string)</option>
                  </select>
                </label>
                <div>
                  <button className="secondary-button compact" onClick={() => setToolDraft(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary-button compact"
                    disabled={!toolDraft.name.trim() || !/^https:\/\/[\w.-]+/.test(toolDraft.url)}
                    onClick={() => {
                      request('/api/account/plugins/custom-tools', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: toolDraft.name,
                          url: toolDraft.url,
                          description: toolDraft.description,
                          method: toolDraft.method,
                          parameters: toolDraft.params
                            .split(',')
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .map((name) => ({ name, type: 'string', required: true })),
                        }),
                      })
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.customTools) setCustomTools(data.customTools);
                          setToolDraft(null);
                        })
                        .catch(() => {});
                    }}
                  >
                    Save tool
                  </button>
                </div>
              </div>
            )}
            <div className="custom-tool-list">
              {customTools.map((tool) => (
                <div className="custom-tool-item" key={tool.id}>
                  <span>
                    <b>{tool.name}</b>
                    <small>
                      {tool.method} {tool.url}
                    </small>
                  </span>
                  <button
                    className="tiny-action danger-text"
                    title="Delete"
                    onClick={() => {
                      request(`/api/account/plugins/custom-tools/${encodeURIComponent(tool.id)}`, {
                        method: 'DELETE',
                      })
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.customTools) setCustomTools(data.customTools);
                        })
                        .catch(() => {});
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {!customTools.length && !toolDraft && (
                <div className="empty-history">No custom tools yet.</div>
              )}
            </div>
          </div>
        ) : tab === 'usage' ? (
          <UsageDashboard request={request} />
        ) : tab === 'profile' ? (
          <div className="profile-settings">
            <label>
              Display name
              <input
                value={displayName}
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label>
              Username
              <input
                value={username}
                maxLength={24}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase());
                  setUsernameState('checking');
                }}
              />
            </label>
            <small className={usernameState === 'taken' ? 'field-error' : 'field-hint'}>
              {usernameState === 'available'
                ? 'Username available'
                : usernameState === 'taken'
                  ? 'Username unavailable'
                  : '3–24 letters, numbers or underscores'}
            </small>
            {profileError && <p className="field-error">{profileError}</p>}
            <button
              className="primary-button"
              disabled={!usernameValid || usernameState === 'checking' || usernameState === 'taken'}
              onClick={async () => {
                try {
                  const updated = await saveProfile({
                    name: displayName,
                    username,
                  });
                  setDisplayName(updated.name);
                  setUsername(updated.username);
                  setProfileError('');
                } catch (e) {
                  setProfileError(e.message);
                }
              }}
            >
              Save profile
            </button>
            <div className="linked-providers">
              <b>Linked sign-in providers</b>
              {['google', 'github', 'discord'].map((provider) => {
                if (user?.linkedAccounts?.some((item) => item.provider === provider)) {
                  return (
                    <span key={provider} className="provider-linked">
                      ✓ {provider} linked
                    </span>
                  );
                }
                // Server state (which OAuth providers the deployment has configured)
                // is not user-facing content: show nothing for unconfigured providers.
                if (!providers?.[provider]) return null;
                return (
                  <a key={provider} href={linkProvider(provider)}>
                    Link {provider}
                  </a>
                );
              })}
            </div>
          </div>
        ) : tab === 'personalization' ? (
          <div className="preference-grid">
            <div className="theme-picker-section">
              <div className="theme-picker-heading">
                <b>Color theme</b>
                <small>Choose a workspace color preset</small>
              </div>
              <div className="theme-preset-grid">
                {COLOR_THEMES.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={`theme-preset ${theme === preset.id ? 'selected' : ''}`}
                    onClick={() => setTheme(preset.id)}
                    aria-pressed={theme === preset.id}
                    title={preset.name}
                  >
                    <span
                      className="theme-swatch"
                      style={{ background: preset.colors[0], borderColor: preset.colors[1] }}
                    >
                      <i style={{ background: preset.colors[1] }} />
                      <i style={{ background: preset.colors[1], opacity: 0.55 }} />
                    </span>
                    <span>{preset.name}</span>
                    {theme === preset.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            </div>
            <section className="persona-section personality-builder">
              <div className="persona-heading">
                <div>
                  <b>Agent personality</b>
                  <p>Build Nemi's character with independent controls. Changes are applied to the actual system instructions, not just the preview.</p>
                </div>
                <span className="persona-active">Custom character</span>
              </div>
              <div className="persona-presentation-controls">
                <div className="personality-group-heading"><b>Communication preferences</b><small>These settings are part of Nemi's character and directly shape its responses.</small></div>
                <div className="persona-presentation-grid">
                  <label>Base style<select value={preferences.baseStyle || 'friendly'} onChange={(event) => update('baseStyle', event.target.value)}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="efficient">Efficient</option><option value="academic">Academic</option><option value="creative">Creative</option><option value="direct">Direct</option></select></label>
                  <label>Base tone<select value={preferences.tone || 'balanced'} onChange={(event) => update('tone', event.target.value)}><option value="balanced">Balanced</option><option value="casual">Casual</option><option value="formal">Formal</option><option value="empathetic">Empathetic</option><option value="technical">Technical</option><option value="playful">Playful</option></select></label>
                  <label className="personality-slider"><span className="personality-slider-title"><b>Warmth</b><output>{preferences.warmth ?? 3}/5</output></span><input type="range" min="1" max="5" step="1" value={preferences.warmth ?? 3} onChange={(event) => update('warmth', Number(event.target.value))}/><span className="personality-slider-ends"><small>Reserved</small><small>Warm</small></span></label>
                  <label className="personality-slider"><span className="personality-slider-title"><b>Enthusiasm</b><output>{preferences.enthusiasm ?? 3}/5</output></span><input type="range" min="1" max="5" step="1" value={preferences.enthusiasm ?? 3} onChange={(event) => update('enthusiasm', Number(event.target.value))}/><span className="personality-slider-ends"><small>Calm</small><small>Energetic</small></span></label>
                  <label>Emoji usage<select value={preferences.emoji || 'moderate'} onChange={(event) => update('emoji', event.target.value)}><option value="none">None</option><option value="minimal">Minimal</option><option value="moderate">Moderate</option><option value="expressive">Expressive</option></select></label>
                </div>
                <div className="persona-formatting-toggles">
                  <Toggle label="Visual answers when useful" value={preferences.visualAnswers !== false} onChange={(value) => update('visualAnswers', value)}/>
                  <Toggle label="Use headers" value={preferences.headers !== false} onChange={(value) => update('headers', value)}/>
                  <Toggle label="Use lists" value={preferences.lists !== false} onChange={(value) => update('lists', value)}/>
                </div>
              </div>
              <div className="personality-quickstarts">
                <span>Quick starts</span>
                {[
                  ['Balanced', { professionalism: 70, friendliness: 70, humor: 40, directness: 65, explanatoryDepth: 55, criticalThinking: 65, creativity: 60, confidence: 65, curiosity: 60, analyticalDepth: 65, autonomy: 60, initiative: 60, empathy: 70, thoroughness: 70, riskTolerance: 35, intensity: 65 }],
                  ['Engineering', { professionalism: 90, friendliness: 55, humor: 15, directness: 85, explanatoryDepth: 75, criticalThinking: 95, creativity: 65, confidence: 75, curiosity: 75, analyticalDepth: 95, autonomy: 80, initiative: 85, empathy: 55, thoroughness: 95, riskTolerance: 25, intensity: 85 }],
                  ['Mentor', { professionalism: 65, friendliness: 90, humor: 45, directness: 55, explanatoryDepth: 95, criticalThinking: 75, creativity: 70, confidence: 70, curiosity: 85, analyticalDepth: 75, autonomy: 55, initiative: 70, empathy: 95, thoroughness: 80, riskTolerance: 25, intensity: 75 }],
                  ['Researcher', { professionalism: 85, friendliness: 55, humor: 10, directness: 75, explanatoryDepth: 85, criticalThinking: 100, creativity: 70, confidence: 65, curiosity: 95, analyticalDepth: 100, autonomy: 65, initiative: 75, empathy: 50, thoroughness: 95, riskTolerance: 20, intensity: 85 }],
                ].map(([name, values]) => <button type="button" key={name} onClick={() => { setPersonalityDraft({ ...defaultPersonality, ...values }); setPersonalityMessage(`${name} quick start applied. You can still adjust every slider.`); }}>{name}</button>)}
              </div>
              {[
                { id: 'communication', title: 'Communication style', description: 'How Nemi speaks and presents information.', dimensions: [
                  ['professionalism', 'Professionalism', 'Casual', 'Formal'], ['friendliness', 'Friendliness', 'Reserved', 'Warm'], ['humor', 'Humor', 'Serious', 'Playful'], ['directness', 'Directness', 'Gentle', 'Blunt'], ['explanatoryDepth', 'Explanatory depth', 'Concise', 'Detailed'],
                ] },
                { id: 'intellectual', title: 'Intellectual character', description: 'How Nemi reasons, questions, and explores ideas.', dimensions: [
                  ['criticalThinking', 'Critical thinking', 'Agreeable', 'Challenges assumptions'], ['creativity', 'Creativity', 'Conventional', 'Innovative'], ['confidence', 'Confidence', 'Cautious', 'Assertive'], ['curiosity', 'Curiosity', 'Task-focused', 'Exploratory'], ['analyticalDepth', 'Analytical depth', 'High-level', 'Deep analysis'],
                ] },
                { id: 'behavior', title: 'Agent behavior', description: 'How Nemi takes initiative and handles work.', dimensions: [
                  ['autonomy', 'Autonomy', 'Wait for direction', 'Proactive within permissions'], ['initiative', 'Initiative', 'Reactive', 'Takes initiative'], ['empathy', 'Empathy', 'Objective', 'Empathetic'], ['thoroughness', 'Thoroughness', 'Lightweight', 'Meticulous'], ['riskTolerance', 'Risk tolerance', 'Conservative', 'Experimental'],
                ] },
              ].map((group) => (
                <div className="personality-group" key={group.id}>
                  <div className="personality-group-heading"><b>{group.title}</b><small>{group.description}</small></div>
                  <div className="personality-slider-grid">
                    {group.dimensions.map(([key, label, low, high]) => (
                      <label className="personality-slider" key={key}>
                        <span className="personality-slider-title"><b>{label}</b><output>{personalityDraft[key] ?? defaultPersonality[key]}%</output></span>
                        <input type="range" min="0" max="100" step="5" value={personalityDraft[key] ?? defaultPersonality[key]} onChange={(event) => setPersonalityDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} />
                        <span className="personality-slider-ends"><small>{low}</small><small>{high}</small></span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="personality-intensity">
                <div className="personality-group-heading"><b>Personality intensity</b><small>Controls how strongly these traits shape the agent's behavior.</small></div>
                <label className="personality-slider">
                  <span className="personality-slider-title"><b>Trait expression</b><output>{personalityDraft.intensity ?? 70}%</output></span>
                  <input type="range" min="0" max="100" step="5" value={personalityDraft.intensity ?? 70} onChange={(event) => setPersonalityDraft((current) => ({ ...current, intensity: Number(event.target.value) }))} />
                  <span className="personality-slider-ends"><small>Subtle</small><small>Strong character</small></span>
                </label>
              </div>
              <div className="personality-preview">
                <div><b>Live personality preview</b><small>Illustrative summary of the current controls</small></div>
                <p>{buildPersonalityPreview({ ...personalityDraft, ...preferences })}</p>
              </div>
              <div className="personality-profile-tools">
                <label>Save profile<input value={profileNameDraft} maxLength={32} onChange={(event) => setProfileNameDraft(event.target.value)} placeholder="e.g. Principal Engineer" /></label>
                <button type="button" className="secondary-button" disabled={!profileNameDraft.trim()} onClick={() => {
                  const styleKeys = ['baseStyle', 'tone', 'warmth', 'enthusiasm', 'emoji', 'visualAnswers', 'headers', 'lists'];
                  const stylePreferences = Object.fromEntries(styleKeys.map((key) => [key, preferences[key] ?? DEFAULT_PREFERENCES[key]]));
                  const next = [...personalityProfiles.filter((item) => item.name !== profileNameDraft.trim()), { name: profileNameDraft.trim(), values: personalityDraft, stylePreferences }].slice(-12);
                  setPersonalityProfiles(next); localStorage.setItem('nemotron.personalityProfiles', JSON.stringify(next)); setProfileNameDraft(''); setPersonalityMessage('Personality profile saved on this device.');
                }}>Save profile</button>
                <button type="button" className="secondary-button" onClick={() => { setPersonalityDraft({ ...defaultPersonality }); ['baseStyle', 'tone', 'warmth', 'enthusiasm', 'emoji', 'visualAnswers', 'headers', 'lists'].forEach((key) => update(key, DEFAULT_PREFERENCES[key])); setPersonalityMessage('All agent personality and communication controls reset to defaults.'); }}>Reset controls</button>
                <button type="button" className="secondary-button" onClick={() => {
                  const blob = new Blob([JSON.stringify({ version: 2, personality: personalityDraft, stylePreferences: Object.fromEntries(['baseStyle', 'tone', 'warmth', 'enthusiasm', 'emoji', 'visualAnswers', 'headers', 'lists'].map((key) => [key, preferences[key] ?? DEFAULT_PREFERENCES[key]])) }, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'nemi-personality.json'; anchor.click(); URL.revokeObjectURL(url);
                }}>Export</button>
                <label className="personality-import">Import<input type="file" accept="application/json,.json" onChange={async (event) => {
                  try { const file = event.target.files?.[0]; if (!file) return; const parsed = JSON.parse(await file.text()); const source = parsed.personality || parsed; const next = Object.fromEntries(Object.keys(defaultPersonality).map((key) => { const numeric = Number(source[key] ?? defaultPersonality[key]); return [key, Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric / 5) * 5)) : defaultPersonality[key]]; })); setPersonalityDraft(next); const style = parsed.stylePreferences || {}; const allowed = { baseStyle: ['friendly', 'professional', 'efficient', 'academic', 'creative', 'direct'], tone: ['balanced', 'casual', 'formal', 'empathetic', 'technical', 'playful'], emoji: ['none', 'minimal', 'moderate', 'expressive'] }; Object.entries(allowed).forEach(([key, values]) => { if (values.includes(style[key])) update(key, style[key]); }); ['warmth', 'enthusiasm'].forEach((key) => { if (Number.isFinite(Number(style[key]))) update(key, Math.max(1, Math.min(5, Number(style[key])))); }); ['visualAnswers', 'headers', 'lists'].forEach((key) => { if (typeof style[key] === 'boolean') update(key, style[key]); }); setPersonalityMessage('Personality profile imported.'); }
                  catch { setPersonalityMessage('Could not import that personality file.'); } finally { event.target.value = ''; }
                }} /></label>
              </div>
              {personalityProfiles.length > 0 && <div className="personality-saved-profiles"><b>Saved profiles</b>{personalityProfiles.map((profile) => <div key={profile.name}><button type="button" onClick={() => { setPersonalityDraft({ ...defaultPersonality, ...profile.values }); Object.entries(profile.stylePreferences || {}).forEach(([key, value]) => { if (['baseStyle', 'tone', 'warmth', 'enthusiasm', 'emoji', 'visualAnswers', 'headers', 'lists'].includes(key)) update(key, value); }); setPersonalityMessage(`${profile.name} loaded.`); }}>{profile.name}</button><button type="button" aria-label={`Delete ${profile.name}`} onClick={() => { const next = personalityProfiles.filter((item) => item.name !== profile.name); setPersonalityProfiles(next); localStorage.setItem('nemotron.personalityProfiles', JSON.stringify(next)); }}>×</button></div>)}</div>}
              <small className="personality-message">Slider changes auto-save to your account. Named profiles are stored locally on this device.</small>
              {personalityMessage && <small className="personality-message">{personalityMessage}</small>}
              <label className="persona-custom-label">
                Additional personality instructions <span>Optional · up to 1,600 characters</span>
                <textarea maxLength={1600} rows={3} value={personaDraft} onChange={(event) => setPersonaDraft(event.target.value)} onBlur={() => { if (personaDraft !== (preferences.personaInstructions || '')) update('personaInstructions', personaDraft); }} placeholder="Example: Challenge weak assumptions, explain important trade-offs, and verify implementations before declaring completion." />
              </label>
              <small className="persona-character-count">{personaDraft.length}/1600 · Custom instructions cannot override safety, permissions, or system rules.</small>
            </section>
          </div>
        ) : (
          <div className="memory-manager">
            <div className="memory-intro">
              <b>Saved memories</b>
              <p>
                Information saved here can be used to personalize future conversations. Avoid
                storing secrets.
              </p>
            </div>
            <div className="memory-add">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add something you want the assistant to remember…"
                rows={2}
              />
              <div>
                <button
                  className="secondary-button compact"
                  onClick={() => {
                    setDraft('');
                    setEditing(null);
                  }}
                >
                  Clear
                </button>
                <button
                  className="primary-button compact"
                  onClick={saveMemory}
                  disabled={!draft.trim()}
                >
                  {editing ? 'Save change' : 'Add memory'}
                </button>
              </div>
            </div>
            <div className="memory-list">
              {memories.map((memory) => (
                <div className="memory-item" key={memory._id}>
                  <p>{memory.text}</p>
                  <div>
                    <button
                      className="tiny-action"
                      title="Edit"
                      onClick={() => {
                        setEditing(memory._id);
                        setDraft(memory.text);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="tiny-action danger-text"
                      title="Delete"
                      onClick={() => deleteMemory(memory._id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {!memories.length && <div className="empty-history">No saved memories yet.</div>}
            </div>
          </div>
        )}
        <footer className="modal-foot">
          <span className="save-hint">Changes save automatically.</span>
          <button className="primary-button" onClick={onClose}>
            <Check size={15} /> Done
          </button>
        </footer>
      </section>
    </div>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`switch ${value ? 'on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </label>
  );
}

function PublicSharePage({ shareId }) {
  const [share, setShare] = useState(null),
    [error, setError] = useState(''),
    [errorStatus, setErrorStatus] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setErrorStatus(0);
    setShare(null);
    request(`/api/public/shares/${encodeURIComponent(shareId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (alive) setShare(data.share);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setErrorStatus(e.status || 0);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [shareId]);
  useEffect(() => {
    document.title = share?.title
      ? `${share.title} · Nemotron Agent Lab`
      : 'Shared response · Nemotron Agent Lab';
  }, [share]);
  if (!loading && errorStatus === 404)
    return (
      <StatusPage
        code="404"
        title="Shared content not found"
        message={error || 'This link may have been revoked or expired.'}
      />
    );
  if (!loading && errorStatus === 503)
    return (
      <StatusPage
        code="503"
        title="Sharing service unavailable"
        message={error}
        actionLabel="Retry"
        onAction={() => location.reload()}
      />
    );
  return (
    <div className="public-share-page">
      <header>
        <div className="brand-mark">✦</div>
        <b>Nemotron Agent Lab</b>
        <span>Shared content</span>
      </header>
      <main>
        {loading ? (
          <div className="share-loading-skeleton">
            <Skeleton width="42%" height={18} />
            <Skeleton width="86%" height={80} />
            <Skeleton width="70%" height={58} />
          </div>
        ) : error ? (
          <div className="share-error">
            <AlertCircle />
            {error}
          </div>
        ) : (
          <>
            <div className="eyebrow">
              {share.shareType === 'chat' ? 'SHARED CONVERSATION' : 'PUBLIC SNAPSHOT'}
            </div>
            <h1>{share.title}</h1>
            {share.messages.map((message, i) => (
              <article className="share-message" key={i}>
                <div className="share-role">
                  {message.role === 'user' ? 'Prompt' : 'Assistant response'}
                </div>
                {message.role === 'assistant' ? (
                  <Markdown content={message.content} />
                ) : (
                  <div className="user-text">{message.content}</div>
                )}
              </article>
            ))}
            {share.artifacts?.length > 0 && (
              <section className="shared-artifacts">
                <h2>Generated files</h2>
                {share.artifacts.map((file) => (
                  <a
                    key={file.id}
                    href={api(
                      `/api/public/shares/${encodeURIComponent(shareId)}/artifacts/${encodeURIComponent(file.id)}`
                    )}
                  >
                    <FileText size={15} />
                    <span>
                      <b>{file.name}</b>
                      <small>{formatBytes(file.size)}</small>
                    </span>
                    <Download size={14} />
                  </a>
                ))}
              </section>
            )}
            <p className="share-disclaimer">
              This is a read-only, point-in-time snapshot. Private credentials and live account
              access are not included.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState({
    loading: true,
    user: null,
    providers: {},
    error: '',
  });
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES),
    [theme, setTheme] = useState(() => {
      try {
        const saved = localStorage.getItem('nemotron.colorTheme');
        return COLOR_THEMES.some((item) => item.id === saved) ? saved : 'forest';
      } catch {
        return 'forest';
      }
    }),
    [memories, setMemories] = useState([]),
    [shares, setShares] = useState([]),
    [sharesLoading, setSharesLoading] = useState(false),
    [accountResourcesLoading, setAccountResourcesLoading] = useState(false),
    [shareBusy, setShareBusy] = useState(false);
  const [chats, setChats] = useState([]),
    [activeId, setActiveId] = useState(null),
    [deletingChatIds, setDeletingChatIds] = useState(() => new Set()),
    [metaChat, setMetaChat] = useState(null),
    [deleteConfirmChatId, setDeleteConfirmChatId] = useState(null),
    [deleteConfirmInput, setDeleteConfirmInput] = useState(''),
    [dragging, setDragging] = useState(false),
    [chatsLoaded, setChatsLoaded] = useState(false),
    [routeError, setRouteError] = useState(''),
    [fatalError, setFatalError] = useState(null),
    [messages, setMessages] = useState([]),
    [activeBranchId, setActiveBranchId] = useState('main'),
    [branches, setBranches] = useState([]),
    [chatLoading, setChatLoading] = useState(false),
    [chatLoadError, setChatLoadError] = useState('');
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('Ready'),
    [toast, setToast] = useState(null),
    [liveProgress, setLiveProgress] = useState(null),
    [progressClock, setProgressClock] = useState(Date.now()),
    [drawer, setDrawer] = useState(false),
    [prefsOpen, setPrefsOpen] = useState(false),
    [libraryOpen, setLibraryOpen] = useState(false),
    [libraryRefresh, setLibraryRefresh] = useState(0);
  const [input, setInput] = useState(''),
    [files, setFiles] = useState([]),
    [thinking, setThinking] = useState(true),
    [scrollDown, setScrollDown] = useState(false);
  const scrollRef = useRef(null),
    textareaRef = useRef(null),
    fileRef = useRef(null),
    abortRef = useRef(null),
    followScrollRef = useRef(true),
    titleRequestRef = useRef(0),
    activeIdRef = useRef(null),
    manualTitleIdsRef = useRef(new Set()),
    chatLoadSeqRef = useRef(0),
    initialRouteHandledRef = useRef(false),
    loadStartedRef = useRef(false),
    authFeedbackRef = useRef(null);
  const activeChat = useMemo(() => chats.find((c) => c._id === activeId), [chats, activeId]);
  const activePlan = useMemo(() => latestActivePlan(messages), [messages]);
  const setFileError = (message) =>
    setToast(message ? { id: Date.now(), message: String(message), type: 'error' } : null);
  const starterSuggestions = useMemo(() => {
    const recent = chats
      .filter((c) => c.title && c.title !== 'New chat')
      .slice(0, 2)
      .map((chat) => ({
        icon: MessageSquare,
        label: `Continue: ${chat.title.slice(0, 28)}`,
        prompt: `Find my previous chat titled "${chat.title}" and continue from its context.`,
      }));
    const memoryFacts = memories.map((memory) => String(memory.text || '').trim()).filter(Boolean);
    const styleMemory = memoryFacts.find((fact) =>
      /\b(prefer|prefers|like|likes|style|concise|example|format|tone|language)\b/i.test(fact)
    );
    const projectMemory = memoryFacts.find((fact) =>
      /\b(working on|building|developing|project|goal|learning|migrating)\b/i.test(fact)
    );
    const personalized = [];
    if (styleMemory) {
      personalized.push({
        icon: Sparkles,
        label: 'Use my preferred style',
        prompt: `Help me with a coding task using this preference: ${styleMemory.slice(0, 300)}`,
      });
    }
    if (projectMemory) {
      personalized.push({
        icon: Code2,
        label: 'Make progress on my goal',
        prompt: `Help me make practical progress on this: ${projectMemory.slice(0, 300)}`,
      });
    }
    return [...personalized, ...recent, ...SUGGESTIONS].slice(0, 5);
  }, [chats, memories]);

  const loadAccount = useCallback(async () => {
    try {
      if (authFeedbackRef.current === null) {
        const feedbackQuery = new URLSearchParams(location.search);
        authFeedbackRef.current = {
          authError: feedbackQuery.get('auth_error') || '',
          linkedProvider: feedbackQuery.get('account_linked') || '',
          linkError: feedbackQuery.get('account_link_error') || '',
        };
        feedbackQuery.delete('auth_error');
        feedbackQuery.delete('account_linked');
        feedbackQuery.delete('account_link_error');
        const query = feedbackQuery.toString();
        if (
          authFeedbackRef.current.authError ||
          authFeedbackRef.current.linkedProvider ||
          authFeedbackRef.current.linkError
        )
          history.replaceState(
            {},
            '',
            `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
          );
      }
      const { authError, linkedProvider, linkError } = authFeedbackRef.current;
      const [meRes, healthRes] = await Promise.all([
        request('/api/auth/me'),
        request('/api/health'),
      ]);
      const [me, health] = await Promise.all([meRes.json(), healthRes.json()]);
      if (!me.user) {
        setAuth({
          loading: false,
          user: null,
          providers: health.oauth || {},
          error: authError,
        });
        return;
      }
      setFatalError(null);
      setAuth({
        loading: false,
        user: me.user,
        providers: health.oauth || {},
        error: '',
      });
      setChatLoading(true);
      setChatsLoaded(false);
      setChatLoadError('');
      if (linkedProvider)
        setToast({ id: Date.now(), message: `${linkedProvider} account linked.`, type: 'success' });
      if (linkError) setFileError(linkError);

      setAccountResourcesLoading(true);
      // Load independent account resources concurrently. The chat list endpoint
      // returns metadata only; fetch the selected conversation once afterwards.
      const [prefResult, memoryResult, chatResult] = await Promise.allSettled([
        request('/api/account/preferences').then((r) => r.json()),
        request('/api/account/memories').then((r) => r.json()),
        request('/api/chats').then((r) => r.json()),
      ]);
      if (prefResult.status === 'fulfilled')
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...prefResult.value.preferences,
        });
      if (memoryResult.status === 'fulfilled') setMemories(memoryResult.value.memories || []);
      setAccountResourcesLoading(false);
      if (chatResult.status !== 'fulfilled') throw chatResult.reason;
      const chatList = Array.isArray(chatResult.value.chats) ? chatResult.value.chats : [];
      setChats(chatList);
      setChatsLoaded(true);
      setActiveId(null);
      activeIdRef.current = null;
      setMessages([]);
      setActiveBranchId('main');
      setBranches([]);
      setChatLoading(false);
      try {
        localStorage.removeItem('nemotron.activeChatId');
      } catch {}
    } catch (error) {
      setAccountResourcesLoading(false);
      if (error.message === 'Authentication required.') {
        try {
          const h = await (await request('/api/health')).json();
          setAuth({
            loading: false,
            user: null,
            providers: h.oauth || {},
            error: '',
          });
        } catch {
          setAuth({
            loading: false,
            user: null,
            providers: {},
            error: error.message,
          });
        }
      } else {
        setChatLoading(false);
        if (error.status === 503 || error.status === 502 || error.name === 'TypeError')
          setFatalError({
            status: 503,
            message:
              'The service is temporarily unavailable. Check your server and database, then retry.',
          });
        setChatLoadError(
          `Workspace loading failed: ${error.message}. Refresh the page or retry a conversation.`
        );
        setAuth((a) => ({ ...a, loading: false, error: error.message }));
      }
    }
  }, []);
  useEffect(() => {
    const selected = COLOR_THEMES.find((item) => item.id === theme) || COLOR_THEMES[0];
    document.documentElement.dataset.theme = selected.id;
    try {
      localStorage.setItem('nemotron.colorTheme', selected.id);
    } catch {}
  }, [theme]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setInterval(() => setProgressClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    try {
      const pending = localStorage.getItem('nemotron.pendingGeneration');
      if (pending) {
        localStorage.removeItem('nemotron.pendingGeneration');
        setToast({
          id: Date.now(),
          message: 'A previous generation was interrupted. You can retry it when ready.',
          type: 'error',
        });
      }
    } catch {}
    loadAccount();
  }, [loadAccount]);
  useEffect(() => {
    if (scrollRef.current && followScrollRef.current)
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'auto',
      });
  }, [messages]);
  useEffect(() => {
    if (activeId) localStorage.setItem('nemotron.activeChatId', activeId);
    else localStorage.removeItem('nemotron.activeChatId');
  }, [activeId]);
  useEffect(() => {
    let cancelled = false;
    if (typeof indexedDB === 'undefined') return;
    const dbOpen = indexedDB.open('nemotron-agent-lab', 1);
    dbOpen.onupgradeneeded = () => {
      if (!dbOpen.result.objectStoreNames.contains('drafts'))
        dbOpen.result.createObjectStore('drafts');
    };
    dbOpen.onsuccess = () => {
      const db = dbOpen.result;
      const tx = db.transaction('drafts', 'readonly');
      const get = tx.objectStore('drafts').get('composer');
      get.onsuccess = () => {
        if (!cancelled && !input && typeof get.result === 'string') setInput(get.result);
      };
    };
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    try {
      const dbOpen = indexedDB.open('nemotron-agent-lab', 1);
      dbOpen.onupgradeneeded = () => {
        if (!dbOpen.result.objectStoreNames.contains('drafts'))
          dbOpen.result.createObjectStore('drafts');
      };
      dbOpen.onsuccess = () => {
        const tx = dbOpen.result.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(input, 'composer');
      };
    } catch {}
  }, [input]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('nemotron-memory-sync');
    channel.onmessage = async (event) => {
      if (event.data?.type === 'refresh') {
        try {
          const data = await (await request('/api/account/memories')).json();
          setMemories(data.memories || []);
        } catch {}
      }
    };
    return () => channel.close();
  }, []);
  const newChat = async ({ navigate = true } = {}) => {
    ++chatLoadSeqRef.current;
    setChatLoading(false);
    setChatLoadError('');
    followScrollRef.current = true;
    setActiveId(null);
    activeIdRef.current = null;
    setActiveBranchId('main');
    setBranches([]);
    setMessages([]);
    setInput('');
    setFiles([]);
    setLiveProgress(null);
    setDrawer(false);
    setRouteError('');
    if (navigate && location.pathname !== '/') history.pushState({}, '', '/');
    try {
      localStorage.removeItem('nemotron.activeChatId');
    } catch {}
    return null;
  };
  const createChatRecord = async () => {
    const res = await request('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ title: 'New chat' }),
    });
    const { chat } = await res.json();
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    setActiveId(chat._id);
    activeIdRef.current = chat._id;
    setActiveBranchId('main');
    setBranches(chat.branches || []);
    setMessages([]);
    return chat;
  };
  const selectChat = async (id, { navigate = true } = {}) => {
    const sequence = ++chatLoadSeqRef.current;
    followScrollRef.current = true;
    setActiveId(id);
    activeIdRef.current = id;
    setRouteError('');
    if (navigate && location.pathname !== `/c/${encodeURIComponent(id)}`)
      history.pushState({}, '', `/c/${encodeURIComponent(id)}`);
    setChatLoading(true);
    setChatLoadError('');
    setDrawer(false);
    try {
      let detail;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await request(`/api/chats/${id}`);
          detail = await res.json();
          break;
        } catch (error) {
          if (attempt === 1 || (error.status && error.status < 500 && error.status !== 429))
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
      if (sequence !== chatLoadSeqRef.current) return;
      const { chat } = detail;
      setActiveBranchId(chat.activeBranchId || 'main');
      setBranches(chat.branches || []);
      setMessages(chat.messages || []);
      const savedTop = Number(localStorage.getItem(`nemotron.scroll.${id}`) || 0);
      requestAnimationFrame(() => {
        if (sequence === chatLoadSeqRef.current && scrollRef.current) {
          scrollRef.current.scrollTop = savedTop;
          onScroll();
        }
      });
    } catch (error) {
      if (sequence === chatLoadSeqRef.current) {
        if (error.status === 404) setRouteError('not-found');
        if (error.status === 503 || error.status === 502)
          setFatalError({ status: 503, message: error.message });
        setChatLoadError(
          `Couldn't load this conversation: ${error.message}. Please try selecting it again.`
        );
      }
    } finally {
      if (sequence === chatLoadSeqRef.current) setChatLoading(false);
    }
  };
  const saveMessages = async (id, next, title) => {
    const res = await request(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        messages: next,
        branchId: activeBranchId,
        expectedRevision: activeChat?.revision || 0,
        ...(title ? { title } : {}),
      }),
    });
    const { chat } = await res.json();
    setChats((current) => [chat, ...current.filter((c) => c._id !== chat._id)]);
  };
  const saveAgentPlan = async (plan) => {
    if (!activeId || busy) return;
    const targetIndex = messages.map((message) => Boolean(message.agentPlan)).lastIndexOf(true);
    if (targetIndex < 0) return;
    const next = messages.map((message, messageIndex) =>
      messageIndex === targetIndex ? { ...message, agentPlan: plan } : message
    );
    setMessages(next);
    try {
      await saveMessages(activeId, next);
      setToast({ id: Date.now(), message: 'Execution plan saved.', type: 'success' });
    } catch (error) {
      setToast({
        id: Date.now(),
        message: error.message || 'Could not save the plan.',
        type: 'error',
      });
    }
  };
  const renameChat = async (chat) => {
    const title = window.prompt('Rename conversation', chat.title || 'New chat');
    if (!title?.trim()) return;
    titleRequestRef.current++;
    manualTitleIdsRef.current.add(chat._id);
    const res = await request(`/api/chats/${chat._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: title.trim(), manualTitle: true }),
    });
    const data = await res.json();
    setChats((current) => current.map((item) => (item._id === chat._id ? data.chat : item)));
  };
  const saveChatMeta = async (id, patch) => {
    try {
      const res = await request(`/api/chats/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.chat)
        setChats((current) => current.map((item) => (item._id === id ? data.chat : item)));
      setMetaChat(null);
    } catch {
      setToast({ id: Date.now(), message: 'Could not update the conversation.', type: 'error' });
    }
  };
  const removeChat = (id) => {
    if (deletingChatIds.has(id)) return;
    const chat = chats.find((c) => c._id === id);
    setDeleteConfirmChatId(id);
    setDeleteConfirmInput('');
  };
  const confirmDeleteChat = async () => {
    const id = deleteConfirmChatId;
    if (!id) return;
    if (deleteConfirmInput !== 'DELETE') {
      setDeleteConfirmChatId(null);
      setDeleteConfirmInput('');
      return;
    }
    setDeletingChatIds((current) => new Set(current).add(id));
    try {
      await request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setChats((current) => current.filter((chat) => chat._id !== id));
      if (activeIdRef.current === id) {
        ++chatLoadSeqRef.current;
        abortRef.current?.abort();
        setBusy(false);
        setActiveId(null);
        activeIdRef.current = null;
        setMessages([]);
        setBranches([]);
        setActiveBranchId('main');
        setLiveProgress(null);
        setChatLoading(false);
        setChatLoadError('');
        setDrawer(false);
        setRouteError('');
        history.replaceState({}, '', '/');
        try {
          localStorage.removeItem('nemotron.activeChatId');
        } catch {}
      }
      setToast({ id: Date.now(), message: 'Conversation deleted.', type: 'success' });
    } catch (error) {
      setToast({
        id: Date.now(),
        message: error.message || 'Could not delete conversation.',
        type: 'error',
      });
    } finally {
      setDeletingChatIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setDeleteConfirmChatId(null);
      setDeleteConfirmInput('');
    }
  };
  useEffect(() => {
    const onPopState = () => {
      const match = location.pathname.match(/^\/c\/([^/]+)$/);
      if (match) selectChat(decodeURIComponent(match[1]), { navigate: false });
      else if (location.pathname === '/') newChat({ navigate: false });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (!auth.user || !chatsLoaded || initialRouteHandledRef.current) return;
    const match = location.pathname.match(/^\/c\/([^/]+)$/);
    if (match) {
      initialRouteHandledRef.current = true;
      selectChat(decodeURIComponent(match[1]), { navigate: false });
    } else if (location.pathname === '/') {
      initialRouteHandledRef.current = true;
    }
  }, [auth.user?._id, chatsLoaded]);

  const logout = async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      location.replace('/');
    }
  };
  const savePreferences = async (update) => {
    const next = typeof update === 'function' ? update(preferences) : update;
    setPreferences(next);
    try {
      await request('/api/account/preferences', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
    } catch (error) {
      setFileError(error.message);
    }
  };
  const addMemory = async (text) => {
    const res = await request('/api/account/memories', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setMemories(data.memories || []);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('nemotron-memory-sync');
      channel.postMessage({ type: 'refresh' });
      channel.close();
    }
  };
  const editMemory = async (id, text) => {
    const res = await request(`/api/account/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setMemories(data.memories || []);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('nemotron-memory-sync');
      channel.postMessage({ type: 'refresh' });
      channel.close();
    }
  };
  const deleteMemory = async (id) => {
    const res = await request(`/api/account/memories/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    setMemories(data.memories || []);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('nemotron-memory-sync');
      channel.postMessage({ type: 'refresh' });
      channel.close();
    }
  };
  const loadShares = async () => {
    setSharesLoading(true);
    try {
      const data = await (await request('/api/shares')).json();
      setShares(data.shares || []);
    } catch (error) {
      setToast({
        id: Date.now(),
        message: error.message || 'Could not load shared links.',
        type: 'error',
      });
    } finally {
      setSharesLoading(false);
    }
  };
  const revokeShare = async (shareId) => {
    await request(`/api/shares/${shareId}`, { method: 'DELETE' });
    setShares((current) => current.filter((item) => item.shareId !== shareId));
  };
  const saveProfile = async (profile) => {
    const res = await request('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    setAuth((a) => ({ ...a, user: { ...a.user, ...data.user } }));
    return data.user;
  };
  const linkProvider = (provider) =>
    api(`/api/auth/${provider}/link?returnTo=${encodeURIComponent(location.pathname)}`);
  const createBranchFrom = async (message) => {
    if (!activeId || !message?.id) return;
    const res = await request(`/api/chats/${activeId}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        fromBranchId: activeBranchId,
        forkedFromMessageId: message.id,
        expectedRevision: activeChat?.revision || 0,
      }),
    });
    const data = await res.json();
    setActiveBranchId(data.branch.branchId);
    setBranches(data.chat.branches || []);
    setChats((current) => [data.chat, ...current.filter((c) => c._id !== data.chat._id)]);
    setMessages(data.messages || []);
    setStatus('New branch created');
  };
  const changeVersion = async (message, index) => {
    const res = await request(`/api/chats/${activeId}/messages/${message.id}/version`, {
      method: 'PATCH',
      body: JSON.stringify({
        branchId: activeBranchId,
        index,
        expectedRevision: activeChat?.revision || 0,
      }),
    });
    const data = await res.json();
    setMessages(data.messages || []);
    setChats((current) => [data.chat, ...current.filter((c) => c._id !== data.chat._id)]);
  };
  const shareResponse = async (message) => {
    const res = await request('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        chatId: activeId,
        branchId: activeBranchId,
        messageId: message.id,
      }),
    });
    const data = await res.json();
    setShares((current) => [
      {
        shareId: data.shareId,
        title: activeChat?.title || 'Shared response',
        chatId: activeId,
        shareType: 'snapshot',
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    try {
      await navigator.clipboard.writeText(data.url);
    } catch {
      window.prompt('Copy this share link', data.url);
    }
    setStatus('Share link copied');
  };
  const shareChat = async () => {
    if (!activeId || !messages.length || busy || shareBusy) return;
    setShareBusy(true);
    try {
      const res = await request('/api/shares', {
        method: 'POST',
        body: JSON.stringify({ chatId: activeId, branchId: activeBranchId, shareType: 'chat' }),
      });
      const data = await res.json();
      setShares((current) => [
        {
          shareId: data.shareId,
          title: activeChat?.title || 'Shared conversation',
          chatId: activeId,
          shareType: 'chat',
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      try {
        await navigator.clipboard.writeText(data.url);
      } catch {
        window.prompt('Copy this full conversation share link', data.url);
      }
      setToast({
        id: Date.now(),
        message: `Full conversation link created${data.artifactCount ? ` with ${data.artifactCount} generated file(s)` : ''}.`,
        type: 'success',
      });
    } catch (error) {
      setToast({
        id: Date.now(),
        message: error.message || 'Could not share conversation.',
        type: 'error',
      });
    } finally {
      setShareBusy(false);
    }
  };
  const editUserMessage = async (message, value) => {
    if (value == null || !value.trim()) return;
    const index = messages.findIndex((m) => m.id === message.id);
    if (index < 0) return;
    const parentMessage = messages[index - 1];
    const edited = {
      ...message,
      id: uid(),
      content: value.trim(),
      createdAt: new Date().toISOString(),
      editedFrom: message.id,
    };
    const res = await request(`/api/chats/${activeId}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        fromBranchId: activeBranchId,
        forkedFromMessageId: parentMessage?.id || null,
        messages: [edited],
        expectedRevision: activeChat?.revision || 0,
      }),
    });
    const data = await res.json();
    setActiveBranchId(data.branch.branchId);
    setBranches(data.chat.branches || []);
    setChats((current) => [data.chat, ...current.filter((c) => c._id !== data.chat._id)]);
    setMessages(data.messages || []);
    setInput('');
    await sendMessage('', [], {
      reuseLastUser: true,
      messages: data.messages || [],
      branchId: data.branch.branchId,
      expectedRevision: data.chat.revision || 0,
    });
  };
  const regenerateResponse = async (message) => {
    const index = messages.findIndex((m) => m.id === message.id);
    if (index < 1 || busy) return;
    setBusy(true);
    setStatus('Regenerating response…');
    setLiveProgress(
      thinking
        ? { message: 'Connecting to the agent…', startedAt: Date.now(), lastActivityAt: Date.now() }
        : { type: 'working' }
    );
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, isStreaming: true, toolEvents: [] } : item
      )
    );
    try {
      localStorage.setItem(
        'nemotron.pendingGeneration',
        JSON.stringify({ chatId: activeId, startedAt: Date.now() })
      );
    } catch {}
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetchChatStream(
        api('/api/chat/stream'),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: activeId,
            branchId: activeBranchId,
            expectedRevision: activeChat?.revision || 0,
            preserveExistingMessageId: message.id,
            thinkingEnabled: thinking,
            modelMode: (preferences.activeModel || 'auto') === 'auto' ? 'auto' : 'manual',
            modelAlias: (preferences.activeModel || 'auto') === 'auto' ? 'surge' : preferences.activeModel,
            activePlan: latestActivePlan(messages.slice(0, index)),
            messages: messages.slice(0, index).map((m) => ({
              ...(m.id ? { id: m.id } : {}),
              role: m.role,
              content: m.apiContent || m.content,
              ...(m.createdAt ? { createdAt: m.createdAt } : {}),
              ...(m.attachments?.length ? { attachments: m.attachments } : {}),
            })),
          }),
        },
        controller
      );
      if (!res.ok) throw await responseError(res, 'Could not regenerate the response');
      let regeneratedOutput = '',
        regenerationToolEvents = [];
      for await (const event of readChatEventStream(res, { signal: controller.signal })) {
        if (event.type === 'status') setStatus(event.status || 'Working');
        if (event.type === 'heartbeat')
          setLiveProgress((current) => ({
            ...(current || { startedAt: Date.now(), lastActivityAt: Date.now() }),
            message: event.phase === 'tool'
              ? toolActivityMessage(event.name, event.arguments || {})
              : (event.message || 'The model is processing the request.'),
            lastActivityAt: Date.now(),
          }));
        if (event.type === 'agent_event') {
          const item = event.event || {};
          const progressMessage = item.type === 'progress_update' ? item.message : '';
          if (progressMessage)
            setLiveProgress((current) => ({
              ...(current || { startedAt: Date.now() }),
              message: progressMessage,
              lastActivityAt: Date.now(),
            }));
        }
        if (event.type === 'final_content') {
          setLiveProgress(null);
          regeneratedOutput = event.content || '';
          setMessages((current) =>
            current.map((item) =>
              item.id === message.id
                ? {
                    ...item,
                    content: regeneratedOutput,
                    isStreaming: true,
                    toolEvents: regenerationToolEvents,
                  }
                : item
            )
          );
        }
        if (event.type === 'chunk') {
          setLiveProgress(null);
          regeneratedOutput += event.content || '';
          setMessages((current) =>
            current.map((item) =>
              item.id === message.id
                ? {
                    ...item,
                    content: regeneratedOutput,
                    isStreaming: true,
                    toolEvents: regenerationToolEvents,
                  }
                : item
            )
          );
        }
        if (event.type === 'tool_start') {
          regenerationToolEvents = [
            ...regenerationToolEvents,
            {
              name: event.name,
              status: 'running',
              arguments: event.arguments || {},
              startedAt: event.startedAt,
            },
          ];
          setLiveProgress((current) => ({
            ...(current || { startedAt: Date.now() }),
            message: toolActivityMessage(event.name, event.arguments || {}),
            lastActivityAt: Date.now(),
          }));
          setMessages((current) =>
            current.map((item) =>
              item.id === message.id
                ? { ...item, isStreaming: true, toolEvents: regenerationToolEvents }
                : item
            )
          );
        }
        if (event.type === 'tool_result') {
          const lastIndex = regenerationToolEvents.map((item) => item.name).lastIndexOf(event.name);
          if (lastIndex >= 0)
            regenerationToolEvents = regenerationToolEvents.map((item, itemIndex) =>
              itemIndex === lastIndex
                ? {
                    ...item,
                    status: event.status,
                    result: event.result,
                    error: event.error,
                    startedAt: event.startedAt || item.startedAt,
                    completedAt: event.completedAt,
                    durationMs: event.durationMs,
                  }
                : item
            );
          setMessages((current) =>
            current.map((item) =>
              item.id === message.id
                ? { ...item, isStreaming: true, toolEvents: regenerationToolEvents }
                : item
            )
          );
        }
        if (event.type === 'error')
          throw new ChatStreamError(event.error || 'Regeneration failed.', {
            code: 'CHAT_SERVER_ERROR',
            status: event.status,
          });
        if (event.type === 'stopped') {
          const stopped = new Error('Generation was stopped.');
          stopped.name = 'AbortError';
          throw stopped;
        }
      }
      const refreshed = await (
        await request(`/api/chats/${activeId}?branchId=${activeBranchId}`)
      ).json();
      setMessages(refreshed.chat.messages || []);
      setChats((current) => [refreshed.chat, ...current.filter((c) => c._id !== activeId)]);
      setStatus('Response regenerated');
    } catch (error) {
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? { ...message, isStreaming: false } : item))
      );
      setStatus(error.name === 'AbortError' ? 'Stopped' : 'Regeneration failed');
      if (error.name !== 'AbortError')
        setFileError(chatErrorMessage(error, 'Could not regenerate the response.'));
    } finally {
      abortRef.current = null;
      try {
        localStorage.removeItem('nemotron.pendingGeneration');
      } catch {}
      setBusy(false);
      setLiveProgress(null);
    }
  };

  const generateName = async (id = activeId, source = messages) => {
    if (!id || !source.length) return;
    const requestId = ++titleRequestRef.current;
    const chatSnapshot = chats.find((c) => c._id === id);
    if (manualTitleIdsRef.current.has(id) || chatSnapshot?.titleManuallyEdited) return;
    const first = source.find((m) => m.role === 'user');
    if (!first) return;
    const meaningful = source.filter((m) => ['user', 'assistant'].includes(m.role));
    const contextMessages =
      meaningful.length > 10 ? [...meaningful.slice(0, 2), ...meaningful.slice(-8)] : meaningful;
    const context = contextMessages
      .map(
        (m) =>
          `${m.role.toUpperCase()}: ${textOf(m.content).slice(0, 1800)}${
            m.toolEvents?.length ? `\nTOOLS: ${m.toolEvents.map((t) => t.name).join(', ')}` : ''
          }`
      )
      .join('\n\n')
      .slice(0, 9000);
    setStatus('Naming conversation…');
    const res = await request('/api/chat/title', {
      method: 'POST',
      body: JSON.stringify({ text: context }),
    });
    const { title } = await res.json();
    if (requestId !== titleRequestRef.current) return;
    const patch = await request(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    const { chat } = await patch.json();
    setChats((current) => [chat, ...current.filter((c) => c._id !== id)]);
    setStatus('Ready');
  };
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      setStatus('Clipboard unavailable');
    }
  };
  const exportChat = () => {
    const exportedAt = new Date().toISOString();
    const blob = new Blob(
      [
        JSON.stringify(
          buildChatExport({
            title: activeChat?.title || 'New chat',
            createdAt: activeChat?.createdAt || messages[0]?.createdAt || null,
            updatedAt: activeChat?.updatedAt || messages.at(-1)?.completedAt || null,
            messages,
            exportedAt,
          }),
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = chatExportFilename(activeChat?.title);
    a.click();
    URL.revokeObjectURL(url);
  };
  const sendMessage = async (raw = input, attach = files, options = {}) => {
    // Safety net: an unexpected error in the synchronous prelude below must never
    // leave the composer stuck with busy=true.
    try {
      await runSend(raw, attach, options);
    } catch (error) {
      setBusy(false);
      setFileError(chatErrorMessage(error));
      setStatus('Request failed');
    }
  };
  const runSend = async (raw = input, attach = files, options = {}) => {
    let text = String(raw || '').trim();
    if ((!text && !attach.length && !options.reuseLastUser) || busy) return;
    // When sending attachments, the message becomes multimodal and the server
    // caps each text part at MAX_MULTIMODAL_TEXT_CHARS. Convert oversized text
    // into a text attachment so it is not rejected.
    if (attach.length && text.length > MAX_MULTIMODAL_TEXT_CHARS) {
      const file = textFile(`text-${Date.now()}.txt`, text);
      attach = [...attach, file];
      text = '';
      setFileError(
        `Prompt exceeds ${MAX_MULTIMODAL_TEXT_CHARS.toLocaleString()} characters, so it was attached as ${file.name} instead.`
      );
    }
    setBusy(true);
    setStatus('Preparing request…');
    let chat = activeChat;
    if (!chat) {
      try {
        chat = await createChatRecord();
      } catch (error) {
        setBusy(false);
        setFileError(error.message);
        return;
      }
    }
    let prepared = [];
    try {
      if (attach.length) prepared = await prepareFiles(attach);
    } catch (error) {
      setBusy(false);
      setFileError(error.message);
      return;
    }
    const payloadSize = prepared.reduce(
      (n, item) =>
        n +
        (item.type.startsWith('image/') || item.kind === 'audio' ? item.dataUrl?.length || 0 : 0) +
        (item.frames || []).reduce((s, f) => s + f.dataUrl.length, 0),
      0
    );
    if (payloadSize > 22 * 1024 * 1024) {
      setBusy(false);
      setFileError('Compressed attachments exceed the 22 MB request limit.');
      return;
    }
    const sandboxFiles = prepared.filter((item) => item.dataUrl && !item.frames && item.kind !== 'audio');
    const sandboxUploadBytes = sandboxFiles.reduce(
      (sum, item) => sum + Math.floor(item.dataUrl.length * 0.75),
      0
    );
    if (sandboxFiles.some((item) => Math.floor(item.dataUrl.length * 0.75) > 8 * 1024 * 1024)) {
      setBusy(false);
      setFileError('Each file sent to the Python workspace must be 8 MB or smaller.');
      return;
    }
    if (sandboxUploadBytes > 20 * 1024 * 1024) {
      setBusy(false);
      setFileError('Files sent to the Python workspace cannot exceed 20 MB per message.');
      return;
    }
    let uploaded = [];
    try {
      if (sandboxFiles.length && !options.reuseLastUser) {
        const uploadResult = await request(`/api/chats/${chat._id}/uploads`, {
          method: 'POST',
          body: JSON.stringify({
            files: sandboxFiles.map((item) => ({
              name: item.sandboxName || item.name,
              mimeType: item.sandboxMimeType || item.type,
              dataUrl: item.dataUrl,
            })),
          }),
        });
        uploaded = uploadResult.uploads || [];
      }
    } catch (error) {
      setBusy(false);
      setFileError(error.message || 'Could not upload files to the Python workspace.');
      return;
    }
    try {
      localStorage.setItem(
        'nemotron.pendingGeneration',
        JSON.stringify({ chatId: chat._id, startedAt: Date.now() })
      );
    } catch {}
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    else if (prepared.length)
      parts.push({
        type: 'text',
        text: 'Please read the attached files, media and follow the instructions.',
      });
    for (const item of prepared) {
      if (item.dataUrl && item.type.startsWith('image/'))
        parts.push({ type: 'image_url', image_url: { url: item.dataUrl } });
      else if (item.kind === 'audio' && item.dataUrl)
        parts.push({ type: 'audio_url', audio_url: { url: item.dataUrl } });
      else if (item.kind === 'document' && item.dataUrl) {
        const base64 = String(item.dataUrl).replace(/^data:[^;]+;base64,/, '');
        const decoded = decodeURIComponent(escape(atob(base64)));
        const header = `--- Attached document: ${item.name} ---\n`;
        const footer = `\n--- End of ${item.name} ---`;
        const partOverhead = '[part 1/99]\n'.length;
        const safetyMargin = 500;
        const budget = Math.max(
          1000,
          MAX_MULTIMODAL_TEXT_CHARS - header.length - footer.length - partOverhead - safetyMargin
        );
        const chunks = [];
        for (let i = 0; i < decoded.length; i += budget) chunks.push(decoded.slice(i, i + budget));
        chunks.forEach((chunk, index) => {
          parts.push({
            type: 'text',
            text:
              chunks.length > 1
                ? `${header}[part ${index + 1}/${chunks.length}]\n${chunk}${footer}`
                : `${header}${chunk}${footer}`,
          });
        });
      }
      if (item.frames)
        for (const frame of item.frames) {
          parts.push({
            type: 'text',
            text: `Video frame at ${frame.time.toFixed(2)} seconds from ${item.name}.`,
          });
          parts.push({ type: 'image_url', image_url: { url: frame.dataUrl } });
        }
    }
    let uploadIndex = 0;
    const attachments = prepared.map((item) => {
      const upload = sandboxFiles.includes(item) ? uploaded[uploadIndex++] : null;
      return {
        name: item.name.slice(0, 140),
        type: item.type,
        ...(upload
          ? {
              uploadId: upload.uploadId,
              sandboxPath: upload.sandboxPath,
              size: upload.size,
            }
          : {}),
      };
    });
    const userMessage = options.reuseLastUser
      ? null
      : {
          id: uid(),
          role: 'user',
          content: text || 'Please read the attached files, media and follow the instructions.',
          attachments,
          createdAt: new Date().toISOString(),
          ...(prepared.length ? { apiContent: parts } : {}),
        };
    const nextMessages =
        options.messages || (options.reuseLastUser ? messages : [...messages, userMessage]),
      titleBefore = chat.title || 'New chat';
    const continuingPlan = latestActivePlan(nextMessages);
    if (activeIdRef.current === chat._id) setMessages(nextMessages);
    setInput('');
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const assistantId = uid(),
      startedAt = new Date().toISOString(),
      assistant = {
        id: assistantId,
        role: 'assistant',
        content: '',
        toolEvents: [],
        agentPlan: continuingPlan,
        isStreaming: true,
        startedAt,
        createdAt: startedAt,
      };
    if (activeIdRef.current === chat._id) setMessages([...nextMessages, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();
    setLiveProgress(
      thinking
        ? { message: 'Connecting to the agent…', startedAt: Date.now(), lastActivityAt: Date.now() }
        : { type: 'working' }
    );
    let output = '',
      events = [],
      agentPlan = continuingPlan,
      agentEvents = [],
      usage = null,
      usageByModel = {},
      modelCallsByModel = {},
      routingInfo = null,
      modelInfo = null,
      durationMs = null,
      liveAssistant = assistant;
    const update = () => {
      if (activeIdRef.current === chat._id)
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? {
                  ...liveAssistant,
                  content: output,
                  toolEvents: events,
                  agentPlan,
                  agentEvents,
                  usage,
                  usageByModel,
                  modelCallsByModel,
                  routingDecision: routingInfo,
                  model: modelInfo,
                  modelMode: (preferences.activeModel || 'auto') === 'auto' ? 'auto' : 'manual',
                  durationMs,
                }
              : m
          )
        );
    };
    try {
      setStatus('Connecting…');
      const res = await fetchChatStream(
        api('/api/chat/stream'),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: chat._id,
            branchId: options.branchId || activeBranchId,
            expectedRevision: options.expectedRevision ?? (chat.revision || 0),
            assistantMessageId: assistantId,
            thinkingEnabled: thinking,
            modelMode: (preferences.activeModel || 'auto') === 'auto' ? 'auto' : 'manual',
            modelAlias: (preferences.activeModel || 'auto') === 'auto' ? 'surge' : preferences.activeModel,
            activePlan: continuingPlan,
            messages: nextMessages.map((m) => ({
              ...(m.id ? { id: m.id } : {}),
              role: m.role,
              content: m.apiContent || m.content,
              ...(m.createdAt ? { createdAt: m.createdAt } : {}),
              ...(m.attachments?.length ? { attachments: m.attachments } : {}),
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            })),
          }),
        },
        controller
      );
      if (!res.ok) throw await responseError(res, 'The server could not complete your request');
      for await (const event of readChatEventStream(res, { signal: controller.signal })) {
        if (event.type === 'status') setStatus(event.status || 'Working');
        if (event.type === 'heartbeat')
          setLiveProgress((current) => ({
            ...(current || { startedAt: Date.now(), lastActivityAt: Date.now() }),
            message: event.phase === 'tool'
              ? toolActivityMessage(event.name, event.arguments || {})
              : (event.message || 'The model is processing the request.'),
            lastActivityAt: Date.now(),
          }));
        if (event.type === 'model_selected' || event.type === 'model_switch') {
          const selected = event.type === 'model_switch' ? event.to : event.model;
          modelInfo = selected || modelInfo;
          routingInfo = event.routing || routingInfo;
          if (event.type === 'model_switch') setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: `Switching to ${selected?.name || 'another Nemotron model'} to recover the request.`, lastActivityAt: Date.now() }));
          update();
        }
        if (event.type === 'final_content') {
          setLiveProgress(null);
          output = event.content || '';
          update();
        }
        if (event.type === 'chunk') {
          setLiveProgress(null);
          output += event.content || '';
          setStatus('Generating');
          update();
        }
        if (event.type === 'agent_event') {
          const item = event.event || {};
          agentEvents = [...agentEvents, item];
          if (item.type === 'plan_created' && item.plan) agentPlan = item.plan;
          if (item.type === 'task_updated' && item.plan) agentPlan = item.plan;
          const message = item.type === 'progress_update' ? item.message : '';
          if (message)
            setLiveProgress((current) => ({
              ...(current || { startedAt: Date.now() }),
              message,
              lastActivityAt: Date.now(),
            }));
          update();
        }
        if (event.type === 'tool_start') {
          events = [
            ...events,
            {
              name: event.name,
              status: 'running',
              arguments: event.arguments,
              startedAt: event.startedAt,
            },
          ];
          setStatus(`Using ${event.name.replaceAll('_', ' ')}…`);
          setLiveProgress((current) => ({
            ...(current || { startedAt: Date.now() }),
            message: toolActivityMessage(event.name, event.arguments || {}),
            lastActivityAt: Date.now(),
          }));
          update();
        }
        if (event.type === 'tool_result') {
          if (
            ['execute_python', 'generate_image'].includes(event.name) &&
            event.result?.artifacts?.length
          )
            setLibraryRefresh((v) => v + 1);
          if (event.name === 'save_memory') {
            request('/api/account/memories')
              .then((r) => r.json())
              .then((data) => setMemories(data.memories || []))
              .catch(() => {});
            if (typeof BroadcastChannel !== 'undefined') {
              const channel = new BroadcastChannel('nemotron-memory-sync');
              channel.postMessage({ type: 'refresh' });
              channel.close();
            }
          }
          const index = events.map((x) => x.name).lastIndexOf(event.name);
          if (index >= 0)
            events = events.map((x, i) =>
              i === index
                ? {
                    ...x,
                    status: event.status,
                    error: event.error,
                    result: event.result,
                    startedAt: event.startedAt || x.startedAt,
                    completedAt: event.completedAt,
                    durationMs: event.durationMs,
                  }
                : x
            );
          update();
        }
        if (event.type === 'done') {
          usage = event.usage || usage;
          usageByModel = event.usageByModel || usageByModel;
          modelCallsByModel = event.modelCallsByModel || modelCallsByModel;
          routingInfo = event.routingDecision || routingInfo;
          modelInfo = event.model || modelInfo;
          durationMs = event.durationMs ?? Math.round(performance.now() - started);
          update();
        }
        if (event.type === 'stopped') {
          const stopped = new Error('Generation was stopped.');
          stopped.name = 'AbortError';
          throw stopped;
        }
        if (event.type === 'error')
          throw new ChatStreamError(event.error || 'The server could not complete your request.', {
            code: 'CHAT_SERVER_ERROR',
            status: event.status,
          });
      }
      liveAssistant = {
        ...assistant,
        content: output || '(No text was returned.)',
        isStreaming: false,
        completedAt: new Date().toISOString(),
        toolEvents: events,
        agentPlan,
        agentEvents,
        usage,
        usageByModel,
        modelCallsByModel,
        routingDecision: routingInfo,
        model: modelInfo,
        modelMode: (preferences.activeModel || 'auto') === 'auto' ? 'auto' : 'manual',
        durationMs,
      };
      const saved = [...nextMessages, liveAssistant];
      if (activeIdRef.current === chat._id) setMessages(saved);
      if (typeof indexedDB !== 'undefined') {
        const dbOpen = indexedDB.open('nemotron-agent-lab', 1);
        dbOpen.onsuccess = () =>
          dbOpen.result.transaction('drafts', 'readwrite').objectStore('drafts').delete('composer');
      }
      const refreshed = await (
        await request(`/api/chats/${chat._id}?branchId=${options.branchId || activeBranchId}`)
      ).json();
      setChats((current) => [
        refreshed.chat,
        ...current.filter((c) => c._id !== refreshed.chat._id),
      ]);
      const userTurnCount = saved.filter((m) => m.role === 'user').length;
      if (titleBefore === 'New chat' || (userTurnCount >= 4 && userTurnCount % 4 === 0)) {
        try {
          await generateName(chat._id, saved);
        } catch {
          const fallback = titleFallback(text || attachments[0]?.name || 'New chat');
          await request(`/api/chats/${chat._id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: fallback }),
          });
          setChats((current) =>
            current.map((c) => (c._id === chat._id ? { ...c, title: fallback } : c))
          );
        }
      }
      setStatus('Ready');
    } catch (error) {
      const stopped = error.name === 'AbortError';
      liveAssistant = {
        ...assistant,
        content: output,
        completedAt: new Date().toISOString(),
        isStreaming: false,
        toolEvents: events,
        agentPlan,
        agentEvents,
        error: stopped ? 'Generation stopped.' : chatErrorMessage(error),
        usage,
        usageByModel,
        modelCallsByModel,
        routingDecision: routingInfo,
        model: modelInfo,
        modelMode: (preferences.activeModel || 'auto') === 'auto' ? 'auto' : 'manual',
        durationMs: durationMs ?? Math.round(performance.now() - started),
      };
      if (activeIdRef.current === chat._id)
        setMessages((current) => current.map((m) => (m.id === assistantId ? liveAssistant : m)));
      setStatus(stopped ? 'Stopped' : 'Request failed');
      if (!stopped) setFileError(chatErrorMessage(error));
      try {
        if (options.branchId)
          await request(`/api/chats/${chat._id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              messages: [...nextMessages, liveAssistant],
              branchId: options.branchId,
              expectedRevision: options.expectedRevision ?? (chat.revision || 0),
            }),
          });
        else await saveMessages(chat._id, [...nextMessages, liveAssistant]);
      } catch {
        /* display generation error */
      }
    } finally {
      abortRef.current = null;
      try {
        localStorage.removeItem('nemotron.pendingGeneration');
      } catch {}
      setBusy(false);
      setLiveProgress(null);
    }
  };
  const addFiles = (fileList) => {
    const next = [...fileList];
    if (files.length + next.length > 6) {
      setFileError('Maximum 6 attachments per message.');
      return;
    }
    setFiles((current) => [...current, ...next]);
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      followScrollRef.current = distance < 80;
      setScrollDown(distance > 240);
      if (activeIdRef.current) {
        try {
          localStorage.setItem(`nemotron.scroll.${activeIdRef.current}`, String(el.scrollTop));
        } catch {}
      }
    }
  };

  if (location.pathname.startsWith('/share/'))
    return <PublicSharePage shareId={decodeURIComponent(location.pathname.split('/')[2] || '')} />;
  if (location.pathname !== '/' && !/^\/c\/[^/]+$/.test(location.pathname))
    return (
      <StatusPage
        code="404"
        title="Page not found"
        message="The page you are looking for does not exist."
      />
    );
  if (auth.loading)
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <Skeleton width={150} height={16} />
          <Skeleton width={240} height={10} />
          <Skeleton width={190} height={10} />
        </div>
      </div>
    );
  if (fatalError?.status === 503)
    return (
      <StatusPage
        code="503"
        title="Service temporarily unavailable"
        message={fatalError.message}
        actionLabel="Retry connection"
        onAction={() => {
          setFatalError(null);
          initialRouteHandledRef.current = false;
          setChatsLoaded(false);
          setAuth((current) => ({ ...current, loading: true }));
          loadAccount();
        }}
      />
    );
  if (routeError === 'not-found')
    return (
      <StatusPage
        code="404"
        title="Conversation not found"
        message="This conversation may have been deleted or you may not have access to it."
      />
    );
  if (!auth.user)
    return (
      <LoginScreen providers={auth.providers} error={auth.error} returnTo={location.pathname} />
    );

  return (
    <div className="app agent-lab" data-theme={theme}>
      <header className="topbar">
        <div className="brand-area">
          <button
            className="icon-button"
            title="Conversation history"
            onClick={() => setDrawer(true)}
          >
            <PanelLeft size={17} />
          </button>
          <div className="brand-mark">✦</div>
          <div className="brand-text">
            <b>Nemotron Agent Lab</b>
            <small>PERSONAL WORKSPACE</small>
          </div>
        </div>
        <div className="top-actions">
          {busy && (
            <button
              className="icon-button stop-button"
              title="Stop"
              onClick={() => abortRef.current?.abort()}
            >
              <Square size={14} />
            </button>
          )}
          <button
            className="profile-button"
            title={auth.user.name}
            onClick={() => setPrefsOpen(true)}
          >
            {auth.user.avatar ? <img src={auth.user.avatar} alt="" /> : <UserRound size={16} />}
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-top">
          <div>
            <div className="eyebrow">AGENT WORKSPACE</div>
            <h1>
              {activeChat?.title && activeChat.title !== 'New chat'
                ? activeChat.title
                : 'What are we working on?'}
            </h1>
            <p>Research, create, explore and solve problems with tools.</p>
          </div>
          <div className="workspace-tools">
            {branches.length > 1 && (
              <select
                aria-label="Conversation branch"
                value={activeBranchId}
                onChange={async (e) => {
                  const id = e.target.value;
                  const result = await request(`/api/chats/${activeId}/branches/${id}/activate`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      expectedRevision: activeChat?.revision || 0,
                    }),
                  });
                  const data = await result.json();
                  setActiveBranchId(id);
                  setMessages(data.messages || []);
                  setChats((current) => [
                    data.chat,
                    ...current.filter((c) => c._id !== data.chat._id),
                  ]);
                }}
              >
                <option value={activeBranchId}>
                  Branch {branches.findIndex((b) => b.branchId === activeBranchId) + 1}
                </option>
                {branches
                  .filter((b) => b.branchId !== activeBranchId)
                  .map((b, i) => (
                    <option key={b.branchId} value={b.branchId}>
                      Branch {branches.findIndex((x) => x.branchId === b.branchId) + 1}
                    </option>
                  ))}
              </select>
            )}
            <button
              className="text-action"
              title="Generate conversation name"
              onClick={() => generateName()}
              disabled={!messages.some((m) => m.role === 'user') || busy}
            >
              <Sparkles size={14} />
            </button>
            <button
              className="text-action"
              title="Share full conversation with generated files"
              onClick={shareChat}
              disabled={!messages.length || busy || shareBusy}
            >
              {shareBusy ? <LoaderCircle size={14} className="spin" /> : <Share2 size={14} />}
            </button>
            <button
              className="text-action"
              title="Export conversation"
              onClick={exportChat}
              disabled={!messages.length}
            >
              <Download size={14} />
            </button>
            <button
              className="text-action"
              title="New conversation"
              onClick={newChat}
              disabled={!messages.length}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <section className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chat-inner">
            {chatLoading ? (
              <WorkspaceSkeleton />
            ) : chatLoadError ? (
              <div className="chat-load-error">
                <AlertCircle size={17} />
                <span>{chatLoadError}</span>
                <button onClick={() => (activeId ? selectChat(activeId) : loadAccount())}>
                  Retry
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-symbol">
                  <Sparkles size={23} />
                </div>
                <div className="eyebrow">READY WHEN YOU ARE</div>
                <h2>
                  Let's make
                  <br />
                  <em>something happen.</em>
                </h2>
                <p>
                  Ask a question, analyze data, generate files, research the web or build something.
                  Your agent capabilities are ready automatically.
                </p>
                <div className="suggestions">
                  {starterSuggestions.map(({ icon: Icon, label, prompt }) => (
                    <button key={label} onClick={() => setInput(prompt)}>
                      <Icon size={15} />
                      <span>{label}</span>
                      <ArrowUp size={13} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, index) => (
                <React.Fragment key={m.id || `${m.role}-${m.createdAt}`}>
                  <Message
                    message={m}
                    onCopy={copyText}
                    onEdit={editUserMessage}
                    onBranch={createBranchFrom}
                    onShare={shareResponse}
                    onRegenerate={regenerateResponse}
                    onVersion={changeVersion}
                    liveProgress={liveProgress}
                    progressClock={progressClock}
                    thinking={thinking}
                    onFollowup={(prompt) => sendMessage(prompt, [])}
                  />
                </React.Fragment>
              ))
            )}
          </div>
          {scrollDown && (
            <button
              className="scroll-bottom"
              onClick={() => {
                followScrollRef.current = true;
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }}
            >
              <ArrowDown size={15} />
            </button>
          )}
        </section>
        <div className="composer-area">
          {activePlan && <AgentPlanDock plan={activePlan} onSave={saveAgentPlan} disabled={busy} />}
          {files.length > 0 && (
            <div className="pending-files">
              {files.map((f, i) => (
                <div className="pending-file" key={`${f.name}-${i}`}>
                  {f.type.startsWith('video') ? (
                    <Video size={13} />
                  ) : f.type.startsWith('image') ? (
                    <FileImage size={13} />
                  ) : (
                    <FileText size={13} />
                  )}
                  <span>{f.name}</span>
                  <button onClick={() => setFiles((current) => current.filter((_, n) => n !== i))}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            className={`composer ${dragging ? 'drag-over' : ''}`}
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
              }}
              onPaste={(e) => {
                const pastedFiles = [...(e.clipboardData?.files || [])];
                if (pastedFiles.length) {
                  e.preventDefault();
                  addFiles(pastedFiles);
                  return;
                }
                const pastedText = e.clipboardData?.getData('text/plain') || '';
                const limit = files.length ? MAX_MULTIMODAL_TEXT_CHARS : MAX_TEXT_CHARS;
                if (pastedText.length > limit) {
                  e.preventDefault();
                  const file = textFile(`text-${Date.now()}.txt`, pastedText);
                  addFiles([file]);
                  setFileError(
                    `Pasted text exceeds ${limit.toLocaleString()} characters, so it was attached as ${file.name} instead.`
                  );
                  return;
                }
              }}
              onKeyDown={(e) => {
                // Touch-only devices (phones/tablets): Enter inserts a newline and
                // messages are sent with the send button only.
                if (e.key !== 'Enter' || IS_TOUCH_ONLY) return;
                if (e.shiftKey) return; // Shift+Enter = newline
                e.preventDefault();
                sendMessage();
              }}
              rows={1}
              placeholder="Ask anything, or give your agent a task…"
            />
            <div className="composer-controls">
              <div className="composer-left">
                <button
                  type="button"
                  className="composer-icon"
                  title="Attach images, videos, MP3/WAV audio or documents"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip size={17} />
                </button>
                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,.mp3,.wav,.pdf,.txt,.md,.csv,.tsv,.json,.xml,.zip,.xls,.xlsx,.doc,.docx,.pptx,.py,.js,.jsx,.mjs,.cjs,.ts,.tsx,.html,.css,.sql,.yml,.yaml,.toml,.ini,.cfg,.conf,.log,.sh,.env"
                  multiple
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <select
                  className="model-selector"
                  aria-label="Nemotron model"
                  value={preferences.activeModel || 'auto'}
                  onChange={(event) => savePreferences({ ...preferences, activeModel: event.target.value })}
                  title="Choose Auto routing or a Nemotron model"
                >
                  <option value="auto">Auto · Recommended</option>
                  <option value="bolt">Bolt · Quick text</option>
                  <option value="surge">Surge · Agent workhorse</option>
                  <option value="titan">Titan · Advanced reasoning</option>
                  <option value="vision">Vision · Visual tasks</option>
                  <option value="omni">Omni · Multimodal</option>
                </select>
                <button
                  type="button"
                  className={`thinking-control ${thinking ? 'enabled' : ''}`}
                  onClick={() => {
                    if (thinking) setLiveProgress(null);
                    setThinking((value) => !value);
                  }}
                  title="Toggle model think mode. Private reasoning is never displayed."
                >
                  <Brain size={14} />
                  <span>Think mode</span>
                  <i />
                </button>
              </div>
              <button
                className="send-button"
                type="submit"
                disabled={busy || (!input.trim() && !files.length)}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
          </form>
          <div className="composer-caption">
            <span>
              {IS_TOUCH_ONLY ? (
                'Tap the send button to send'
              ) : (
                <>
                  <kbd>Enter</kbd> send · <kbd>Shift + Enter</kbd> newline
                </>
              )}
            </span>
            <span>{(preferences.activeModel || 'auto') === 'auto' ? 'Auto model routing' : `Model: ${String(preferences.activeModel).toUpperCase()}`} · Think mode {thinking ? 'on' : 'off'}</span>
            <span className="composer-char-counter">
              {input.length}/{MAX_TEXT_CHARS}
            </span>
          </div>
        </div>
      </main>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <HistoryDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        chats={chats}
        activeId={activeId}
        onSelect={selectChat}
        onNew={newChat}
        onDelete={removeChat}
        onRename={renameChat}
        onChatMeta={(chat) => setMetaChat(chat)}
        onOpenLibrary={() => {
          setDrawer(false);
          setLibraryOpen(true);
        }}
        deletingChatIds={deletingChatIds}
        chatsLoaded={chatsLoaded}
      />
      <ChatMetaDialog chat={metaChat} onClose={() => setMetaChat(null)} onSave={saveChatMeta} />
      <FileLibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        refreshKey={libraryRefresh}
      />
      <PreferencesDialog
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        preferences={preferences}
        setPreferences={savePreferences}
        memories={memories}
        addMemory={addMemory}
        editMemory={editMemory}
        deleteMemory={deleteMemory}
        user={auth.user}
        logout={logout}
        saveProfile={saveProfile}
        linkProvider={linkProvider}
        providers={auth.providers}
        shares={shares}
        loadShares={loadShares}
        sharesLoading={sharesLoading}
        accountResourcesLoading={accountResourcesLoading}
        theme={theme}
        setTheme={setTheme}
        revokeShare={revokeShare}
      />
      {deleteConfirmChatId && (
        <div className="modal-layer" onMouseDown={() => setDeleteConfirmChatId(null)}>
          <section className="chat-meta-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <b>Delete conversation</b>
              <button
                className="icon-button"
                onClick={() => {
                  setDeleteConfirmChatId(null);
                  setDeleteConfirmInput('');
                }}
                aria-label="Cancel"
              >
                <X size={16} />
              </button>
            </div>
            <div className="meta-row">
              <span>Type DELETE to confirm permanent deletion of this conversation.</span>
            </div>
            <label className="meta-row">
              <span>Confirm</span>
              <input
                value={deleteConfirmInput}
                maxLength={6}
                placeholder="DELETE"
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button compact"
                onClick={() => {
                  setDeleteConfirmChatId(null);
                  setDeleteConfirmInput('');
                }}
              >
                Cancel
              </button>
              <button
                className="primary-button compact danger-text"
                disabled={deleteConfirmInput !== 'DELETE'}
                onClick={confirmDeleteChat}
              >
                Delete conversation
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
