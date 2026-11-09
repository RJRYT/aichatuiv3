import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  Check,
  Copy,
  Download,
  FileImage,
  FileText,
  FileSpreadsheet,
  FileArchive,
  Files,
  Eye,
  RefreshCw,
  HardDrive,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Paperclip,
  PanelLeft,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Video,
  Wrench,
  X,
  Pencil,
  UserRound,
  SlidersHorizontal,
  Code2,
  Github,
  Share2,
  GitBranch,
  PencilLine,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  ListChecks,
} from 'lucide-react';

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
};
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
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

function CodeBlock({ children, className = '' }) {
  const [copied, setCopied] = useState(false);
  const code = String(children ?? '').replace(/\n$/, '');
  const language = className.match(/language-([\w-]+)/)?.[1] || 'code';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="code-shell">
      <div className="code-head">
        <span>{language}</span>
        <button type="button" onClick={copy}>
          <Copy size={12} />
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <pre className="code-block">
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}
function Markdown({ content }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
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
function toolDisplayName(name = '') {
  const labels = {
    execute_python: 'Python executor',
    generate_image: 'image generator',
    web_search: 'web search',
    fetch_public_url: 'web fetch',
    calculator: 'calculator',
    get_current_datetime: 'date and time tool',
    npm_search: 'npm search',
    github_search: 'GitHub search',
    search_memories: 'memory search',
    save_memory: 'memory tool',
    create_task_plan: 'task planner',
    update_task_status: 'task planner',
  };
  return labels[name] || name.replaceAll('_', ' ');
}

function toolProgressMessage(name, args = {}) {
  const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim();
  if (name === 'web_search') {
    const query = firstText(args.query, args.search_query, args.q, args.search_terms);
    return query ? `Searching for ${query.slice(0, 90)}...` : 'Searching the web...';
  }
  if (name === 'fetch_public_url') {
    const url = firstText(args.url, args.uri);
    return url ? `Fetching URL ${url.slice(0, 100)}...` : 'Fetching requested URL...';
  }
  if (name === 'generate_image') return 'Generating image...';
  if (name === 'create_task_plan') return 'Registering plans...';
  if (name === 'update_task_status') return 'Marking task progress...';
  if (name === 'execute_python') {
    const context = firstText(args.task_context, args.description, args.task);
    if (context && /zip|archive/i.test(context)) return 'Preparing your files as a ZIP...';
    if (context && /patch|edit|modify|update/i.test(context)) return 'Verifying patches...';
    return 'Working on requested files...';
  }
  return `Using ${toolDisplayName(name)}...`;
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
    try { serialized = JSON.stringify(value); } catch { serialized = '[complex value]'; }
    return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
  }
  return String(value);
}

function describeToolCall(event) {
  const args = event.arguments && typeof event.arguments === 'object' ? event.arguments : {};
  const entries = Object.entries(args)
    .filter(([key, value]) => !['code', 'script', 'source', 'content'].includes(key) && value !== undefined && value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatToolArgument(value)}`);
  return entries.length ? `${event.name} · ${entries.join(' · ')}` : event.name;
}

function ToolUsageInline({ events = [] }) {
  if (!events.length) return null;
  const grouped = [...events.reduce((map, event) => {
    const key = `${event.name}:${event.status === 'error' ? 'error' : 'used'}`;
    const current = map.get(key) || { name: event.name, status: event.status, events: [] };
    current.events.push(event);
    map.set(key, current);
    return map;
  }, new Map()).values()];
  return (
    <div className="tool-usage-inline" aria-label="Tool activity">
      {grouped.map((group) => (
        <details className={`tool-usage-item ${group.status || ''}`} key={`${group.name}-${group.status}`}>
          <summary>
            {group.events.length === 1 ? describeToolCall(group.events[0]) : `${group.name} · ${group.events.length} calls`}
          </summary>
          <div className="tool-usage-details">
            {group.events.map((event, index) => <div className="tool-usage-detail-entry" key={`${group.name}-${index}`}>
              <div className="tool-usage-call-title">{describeToolCall(event)}</div>
              {event.error && <p className="tool-error">{event.error}</p>}
              {event.arguments && <div><small>Arguments</small><pre>{JSON.stringify(event.arguments, null, 2)}</pre></div>}
              {event.result !== undefined && <div><small>Result</small><pre>{JSON.stringify(event.result, null, 2).slice(0, 5000)}</pre></div>}
            </div>)}
          </div>
        </details>
      ))}
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
      {isOpen && <div className="artifact-inline-body">
        <ArtifactPreview file={file} expanded />
        <button className="artifact-inline-download" onClick={onDownload}>
          <Download size={13} /> Download file
        </button>
        {downloadError && <p className="artifact-preview-error">{downloadError}</p>}
      </div>}
    </details>
  );
}

function AgentPlanDock({ plan, onSave, disabled = false }) {
  const [draft, setDraft] = useState(plan);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(plan), [plan]);
  if (!plan?.tasks?.length) return null;
  const completed = plan.tasks.filter((task) => ['completed', 'skipped'].includes(task.status)).length;
  const changed = JSON.stringify(draft) !== JSON.stringify(plan);
  const updateTask = (taskId, patch) => {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
    }));
  };
  const save = async () => {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };
  return (
    <details className="agent-plan-dock">
      <summary>
        <ListChecks size={14} />
        <span>Execution plan</span>
        <small>{completed}/{plan.tasks.length} completed</small>
        <ChevronRight size={13} className="plan-chevron" />
      </summary>
      <div className="agent-plan-dock-body">
        <label className="plan-objective-label">Objective</label>
        <textarea
          value={draft?.objective || ''}
          disabled={disabled}
          rows={2}
          onChange={(event) => setDraft((current) => ({ ...current, objective: event.target.value }))}
        />
        <div className="plan-edit-list">
          {(draft?.tasks || []).map((task) => (
            <div className={`plan-edit-task ${task.status || 'pending'}`} key={task.id}>
              <div className="plan-edit-task-state">
                {task.status === 'completed' ? <Check size={13} /> : task.status === 'running' ? <LoaderCircle size={13} className="spin" /> : task.status === 'failed' ? <AlertCircle size={13} /> : <i />}
              </div>
              <div className="plan-edit-fields">
                <input value={task.title} disabled={disabled} onChange={(event) => updateTask(task.id, { title: event.target.value })} aria-label={`Task ${task.id} title`} />
                <textarea value={task.description || ''} disabled={disabled} rows={2} onChange={(event) => updateTask(task.id, { description: event.target.value })} aria-label={`Task ${task.id} description`} />
                <small>{(task.status || 'pending').replaceAll('_', ' ')}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="plan-dock-footer">
          <span>Changes are saved to this conversation.</span>
          <button disabled={disabled || saving || !changed} onClick={save}>{saving ? 'Saving…' : 'Save plan'}</button>
        </div>
      </div>
    </details>
  );
}

function LiveProgress({ progress, now, toolEvents = [] }) {
  if (!progress) return null;
  const elapsed = (timestamp) => {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  return (
    <div className="live-progress" role="status" aria-live="polite">
      <span className="live-progress-orb"><i /></span>
      <div className="live-progress-message"><Markdown content={progress.message} /></div>
      <span className="live-progress-timing">Working {elapsed(progress.startedAt)} · Last worked {elapsed(progress.lastActivityAt)} ago</span>
      {!!toolEvents.length && <ToolUsageInline events={toolEvents} />}
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.type || 'error'}`} role={toast.type === 'success' ? 'status' : 'alert'}>
      {toast.type === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}
      <span>{toast.message}</span>
      <button onClick={onClose} aria-label="Dismiss notification"><X size={14} /></button>
    </div>
  );
}

function Message({ message, onCopy, onEdit, onBranch, onShare, onRegenerate, onVersion, liveProgress, progressClock }) {
  const [editing, setEditing] = useState(false),
    [editDraft, setEditDraft] = useState(textOf(message.content));
  const user = message.role === 'user',
    content = textOf(message.content);
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
        </div>
        {!user && message.isStreaming && liveProgress && (
          <LiveProgress progress={liveProgress} now={progressClock} toolEvents={message.toolEvents || []} />
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
              <div className="user-text">{content}</div>
            )
          ) : (
            <Markdown content={content} />
          ))}
        {!user && !message.isStreaming && (() => {
          const generated = [...new Map((message.toolEvents || [])
            .flatMap((event) => event.result?.artifacts || [])
            .filter((file) => file?.id)
            .map((file) => [file.id, file])).values()];
          return generated.length ? (
            <div className="message-inline-artifacts">
              {generated.map((file) => <InlineArtifact key={file.id} file={file} />)}
            </div>
          ) : null;
        })()}
        {message.error && (
          <div className="message-error">
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

function LoginScreen({ providers, error }) {
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
          Sign in to access your conversations, saved memories and personal preferences.
        </p>
        {error && <div className="notice error-notice">{error}</div>}
        <div className="oauth-list">
          {Object.keys(labels).map((provider) => (
            <a
              className={`oauth-button ${providers?.[provider] ? '' : 'disabled'}`}
              href={providers?.[provider] ? api(`/api/auth/${provider}`) : undefined}
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
            <div className="library-empty">
              <LoaderCircle className="spin" size={19} /> Loading files…
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

function HistoryDrawer({
  open,
  onClose,
  chats,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onOpenLibrary,
}) {
  if (!open) return null;
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
        <div className="history-list">
          {chats.map((chat) => (
            <div className={`history-item ${chat._id === activeId ? 'active' : ''}`} key={chat._id}>
              <button className="history-select" onClick={() => onSelect(chat._id)}>
                <MessageSquare size={15} />
                <span>
                  <b>{chat.title || 'New chat'}</b>
                  <small>{dateLabel(chat.updatedAt)}</small>
                </span>
              </button>
              <button className="delete-chat" onClick={() => onRename(chat)} title="Rename">
                <Pencil size={13} />
              </button>
              <button className="delete-chat" onClick={() => onDelete(chat._id)} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!chats.length && <p className="empty-history">No conversations yet.</p>}
        </div>
      </aside>
    </div>
  );
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
  revokeShare,
  providers,
}) {
  const [tab, setTab] = useState('profile'),
    [draft, setDraft] = useState(''),
    [editing, setEditing] = useState(null),
    [displayName, setDisplayName] = useState(user?.name || ''),
    [username, setUsername] = useState(user?.username || ''),
    [usernameState, setUsernameState] = useState('idle'),
    [profileError, setProfileError] = useState('');
  const usernameValid = /^[a-z0-9_]{3,24}$/.test(username);
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
            <h2>Personalization</h2>
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
        </div>
        {tab === 'shares' ? (
          <div className="shared-links">
            {shares.map((share) => (
              <div key={share.shareId}>
                <span>
                  <b>{share.title}</b>
                  <small>{dateLabel(share.createdAt)}</small>
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
            ))}
            {!shares.length && <p className="empty-history">No active shared links.</p>}
          </div>
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
              {['google', 'github', 'discord'].map((provider) =>
                user?.linkedAccounts?.some((item) => item.provider === provider) ? (
                  <span key={provider} className="provider-linked">
                    ✓ {provider} linked
                  </span>
                ) : providers?.[provider] ? (
                  <a key={provider} href={linkProvider(provider)}>
                    Link {provider}
                  </a>
                ) : (
                  <span key={provider} className="provider-unavailable">
                    {provider} not configured
                  </span>
                )
              )}
            </div>
          </div>
        ) : tab === 'personalization' ? (
          <div className="preference-grid">
            <label>
              Base style
              <select
                value={preferences.baseStyle}
                onChange={(e) => update('baseStyle', e.target.value)}
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="efficient">Efficient</option>
                <option value="academic">Academic</option>
                <option value="creative">Creative</option>
                <option value="direct">Direct</option>
              </select>
            </label>
            <label>
              Base tone
              <select value={preferences.tone} onChange={(e) => update('tone', e.target.value)}>
                <option value="balanced">Balanced</option>
                <option value="casual">Casual</option>
                <option value="formal">Formal</option>
                <option value="empathetic">Empathetic</option>
                <option value="technical">Technical</option>
                <option value="playful">Playful</option>
              </select>
            </label>
            <label>
              Warmth <output>{preferences.warmth}/5</output>
              <input
                type="range"
                min="1"
                max="5"
                value={preferences.warmth}
                onChange={(e) => update('warmth', Number(e.target.value))}
              />
            </label>
            <label>
              Enthusiasm <output>{preferences.enthusiasm}/5</output>
              <input
                type="range"
                min="1"
                max="5"
                value={preferences.enthusiasm}
                onChange={(e) => update('enthusiasm', Number(e.target.value))}
              />
            </label>
            <label>
              Emoji usage
              <select value={preferences.emoji} onChange={(e) => update('emoji', e.target.value)}>
                <option value="none">None</option>
                <option value="minimal">Minimal</option>
                <option value="moderate">Moderate</option>
                <option value="expressive">Expressive</option>
              </select>
            </label>
            <div className="preference-toggles">
              <Toggle
                label="Visual answers when useful"
                value={preferences.visualAnswers}
                onChange={(v) => update('visualAnswers', v)}
              />
              <Toggle
                label="Use headers"
                value={preferences.headers}
                onChange={(v) => update('headers', v)}
              />
              <Toggle
                label="Use lists"
                value={preferences.lists}
                onChange={(v) => update('lists', v)}
              />
            </div>
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
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    request(`/api/public/shares/${encodeURIComponent(shareId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (alive) setShare(data.share);
      })
      .catch((e) => {
        if (alive) setError(e.message);
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
  return (
    <div className="public-share-page">
      <header>
        <div className="brand-mark">✦</div>
        <b>Nemotron Agent Lab</b>
        <span>Shared response</span>
      </header>
      <main>
        {loading ? (
          <div className="loading-screen">
            <LoaderCircle className="spin" /> Loading shared response…
          </div>
        ) : error ? (
          <div className="share-error">
            <AlertCircle />
            {error}
          </div>
        ) : (
          <>
            <div className="eyebrow">PUBLIC SNAPSHOT</div>
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
            <p className="share-disclaimer">
              This is a read-only snapshot. Private chat history and internal tool credentials are
              not included.
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
    [memories, setMemories] = useState([]),
    [shares, setShares] = useState([]);
  const [chats, setChats] = useState([]),
    [activeId, setActiveId] = useState(null),
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
    chatLoadSeqRef = useRef(0);
  const activeChat = useMemo(() => chats.find((c) => c._id === activeId), [chats, activeId]);
  const activePlan = useMemo(() => [...messages].reverse().find((message) => message.agentPlan)?.agentPlan || null, [messages]);
  const setFileError = (message) => setToast(message ? { id: Date.now(), message: String(message), type: 'error' } : null);
  const starterSuggestions = useMemo(() => {
    const recent = chats
      .filter((c) => c.title && c.title !== 'New chat')
      .slice(0, 2)
      .map((chat) => ({
        icon: MessageSquare,
        label: `Continue: ${chat.title.slice(0, 28)}`,
        prompt: `Continue working on my conversation titled \"${chat.title}\". Use the available conversation history as context.`,
      }));
    return [...recent, ...SUGGESTIONS].slice(0, 5);
  }, [chats]);

  const loadAccount = useCallback(async () => {
    try {
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
          error: new URLSearchParams(location.search).get('auth_error') || '',
        });
        return;
      }
      setAuth({
        loading: false,
        user: me.user,
        providers: health.oauth || {},
        error: '',
      });
      setChatLoading(true);
      setChatLoadError('');
      const query = new URLSearchParams(location.search);
      if (query.get('account_linked')) setToast({ id: Date.now(), message: `${query.get('account_linked')} account linked.`, type: 'success' });
      if (query.get('account_link_error')) setFileError(query.get('account_link_error'));

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
      if (chatResult.status !== 'fulfilled') throw chatResult.reason;
      const chatList = Array.isArray(chatResult.value.chats) ? chatResult.value.chats : [];
      setChats(chatList);
      setActiveId(null);
      activeIdRef.current = null;
      setMessages([]);
      setActiveBranchId('main');
      setBranches([]);
      setChatLoading(false);
      try { localStorage.removeItem('nemotron.activeChatId'); } catch {}

    } catch (error) {
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
        setChatLoadError(
          `Workspace loading failed: ${error.message}. Refresh the page or retry a conversation.`
        );
        setAuth((a) => ({ ...a, loading: false, error: error.message }));
      }
    }
  }, []);
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
    try {
      const pending = localStorage.getItem('nemotron.pendingGeneration');
      if (pending) {
        localStorage.removeItem('nemotron.pendingGeneration');
        setToast({ id: Date.now(), message: 'A previous generation was interrupted. You can retry it when ready.', type: 'error' });
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
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const data = await (await request('/api/account/memories')).json();
        setMemories(data.memories || []);
      } catch {}
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const newChat = async () => {
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
    try { localStorage.removeItem('nemotron.activeChatId'); } catch {}
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
  const selectChat = async (id) => {
    const sequence = ++chatLoadSeqRef.current;
    followScrollRef.current = true;
    setActiveId(id);
    activeIdRef.current = id;
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
      if (sequence === chatLoadSeqRef.current)
        setChatLoadError(
          `Couldn't load this conversation: ${error.message}. Please try selecting it again.`
        );
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
    const next = messages.map((message, messageIndex) => messageIndex === targetIndex ? { ...message, agentPlan: plan } : message);
    setMessages(next);
    try {
      await saveMessages(activeId, next);
      setToast({ id: Date.now(), message: 'Execution plan saved.', type: 'success' });
    } catch (error) {
      setToast({ id: Date.now(), message: error.message || 'Could not save the plan.', type: 'error' });
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
  const removeChat = async (id) => {
    await request(`/api/chats/${id}`, { method: 'DELETE' });
    const next = chats.filter((c) => c._id !== id);
    setChats(next);
    if (activeId === id) {
      setActiveId(null);
      activeIdRef.current = null;
      setMessages([]);
      setBranches([]);
      setActiveBranchId('main');
      setLiveProgress(null);
      setDrawer(false);
      try { localStorage.removeItem('nemotron.activeChatId'); } catch {}
    }
  };
  const logout = async () => {
    await request('/api/auth/logout', { method: 'POST' });
    location.href = '/';
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
    try {
      const data = await (await request('/api/shares')).json();
      setShares(data.shares || []);
    } catch {}
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
  const linkProvider = (provider) => api(`/api/auth/${provider}/link`);
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
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    await navigator.clipboard.writeText(data.url);
    setStatus('Share link copied');
  };
  const editUserMessage = async (message, value) => {
    if (value == null || !value.trim()) return;
    const index = messages.findIndex((m) => m.id === message.id);
    if (index < 0) return;
    const parentMessage = messages[index - 1];
    const edited = {
      ...message,
      id: crypto.randomUUID(),
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
    setLiveProgress({ message: 'Thinking through your request...', startedAt: Date.now(), lastActivityAt: Date.now() });
    try {
      localStorage.setItem(
        'nemotron.pendingGeneration',
        JSON.stringify({ chatId: activeId, startedAt: Date.now() })
      );
    } catch {}
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(api('/api/chat/stream'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chatId: activeId,
          branchId: activeBranchId,
          expectedRevision: activeChat?.revision || 0,
          preserveExistingMessageId: message.id,
          thinkingEnabled: thinking,
          activePlan: [...messages.slice(0, index)].reverse().find((item) => item.agentPlan)?.agentPlan || null,
          messages: messages.slice(0, index).map((m) => ({
            role: m.role,
            content: m.apiContent || m.content,
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), {
          stream: !part.done,
        });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const line = block.split(/\r?\n/).find((x) => x.startsWith('data:'));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim());
          if (event.type === 'status') {
            setStatus(event.status || 'Regenerating…');
            setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: event.status || 'Regenerating…', lastActivityAt: Date.now() }));
          }
          if (event.type === 'agent_event') {
            const item = event.event || {};
            const message = item.type === 'plan_created' ? 'Registering plans...'
              : item.type === 'task_updated' && item.task ? item.task.status === 'completed' ? `Marking task as completed: ${item.task.title}` : `Working on: ${item.task.title}`
              : item.type === 'tool_started' ? item.progressTarget ? `${item.name === 'web_search' ? 'Searching for' : 'Fetching URL'} ${item.progressTarget}...` : item.name === 'generate_image' ? 'Generating image...' : item.name === 'fetch_public_url' ? 'Fetching requested URL...' : item.name === 'web_search' ? 'Searching the web...' : item.name === 'execute_python' ? 'Working on requested files...' : `Using ${toolDisplayName(item.name)}...`
              : item.type === 'tool_completed' ? item.name === 'execute_python' ? 'Verifying patches...' : 'Checking results...'
              : item.type === 'self_correction' ? 'Recovering from an issue...'
              : item.type === 'agent_completed' ? 'Generating response...'
              : '';
            if (message) setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message, lastActivityAt: Date.now() }));
          }
          if (event.type === 'error') throw new Error(event.error || 'Regeneration failed.');
        }
        if (part.done) break;
      }
      const refreshed = await (
        await request(`/api/chats/${activeId}?branchId=${activeBranchId}`)
      ).json();
      setMessages(refreshed.chat.messages || []);
      setChats((current) => [refreshed.chat, ...current.filter((c) => c._id !== activeId)]);
      setStatus('Response regenerated');
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Stopped' : 'Regeneration failed');
      setFileError(error.message);
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
    const blob = new Blob(
      [
        JSON.stringify(
          {
            title: activeChat?.title || 'New chat',
            messages: messages.map((m) => ({
              role: m.role,
              content: textOf(m.content),
              toolEvents: m.toolEvents,
            })),
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'agent-lab-chat.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const sendMessage = async (raw = input, attach = files, options = {}) => {
    const text = String(raw || '').trim();
    if ((!text && !attach.length && !options.reuseLastUser) || busy) return;
    setFileError('');
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
        (item.type.startsWith('image/') ? item.dataUrl?.length || 0 : 0) +
        (item.frames || []).reduce((s, f) => s + f.dataUrl.length, 0),
      0
    );
    if (payloadSize > 22 * 1024 * 1024) {
      setBusy(false);
      setFileError('Compressed attachments exceed the 22 MB request limit.');
      return;
    }
    const sandboxFiles = prepared.filter((item) => item.dataUrl && !item.frames);
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
        text: 'Please analyze the attached files and media.',
      });
    for (const item of prepared) {
      if (item.dataUrl && item.type.startsWith('image/'))
        parts.push({ type: 'image_url', image_url: { url: item.dataUrl } });
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
          id: crypto.randomUUID(),
          role: 'user',
          content: text || 'Please analyze the attached files and media.',
          attachments,
          createdAt: new Date().toISOString(),
          ...(prepared.length ? { apiContent: parts } : {}),
        };
    const nextMessages =
        options.messages || (options.reuseLastUser ? messages : [...messages, userMessage]),
      titleBefore = chat.title || 'New chat';
    const continuingPlan = [...nextMessages].reverse().find((message) => message.agentPlan)?.agentPlan || null;
    if (activeIdRef.current === chat._id) setMessages(nextMessages);
    setInput('');
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const assistantId = crypto.randomUUID(),
      assistant = {
        id: assistantId,
        role: 'assistant',
        content: '',
        toolEvents: [],
        agentPlan: continuingPlan,
        isStreaming: true,
        createdAt: new Date().toISOString(),
      };
    if (activeIdRef.current === chat._id) setMessages([...nextMessages, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();
    setLiveProgress({ message: /\bzip\b|\.zip\b/i.test(raw) ? 'Preparing your requested ZIP...' : 'Thinking...', startedAt: Date.now(), lastActivityAt: Date.now() });
    let output = '',
      events = [],
      agentPlan = continuingPlan,
      agentEvents = [],
      usage = null,
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
                  durationMs,
                }
              : m
          )
        );
    };
    try {
      setStatus('Connecting…');
      const res = await fetch(api('/api/chat/stream'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chatId: chat._id,
          branchId: options.branchId || activeBranchId,
          expectedRevision: options.expectedRevision ?? (chat.revision || 0),
          assistantMessageId: assistantId,
          thinkingEnabled: thinking,
          activePlan: continuingPlan,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.apiContent || m.content,
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          })),
        }),
      });
      if (!res.ok) {
        let data = {};
        try {
          data = await res.json();
        } catch {
          data.error = await res.text();
        }
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), {
          stream: !chunk.done,
        });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const line = block.split(/\r?\n/).find((x) => x.startsWith('data:'));
          if (!line) continue;
          let event;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (event.type === 'status') {
            setStatus(event.status || 'Working…');
            setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: event.status || 'Working…', lastActivityAt: Date.now() }));
          }
          if (event.type === 'chunk') {
            output += event.content || '';
            setStatus('Generating…');
            setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: 'Putting the response together...', lastActivityAt: Date.now() }));
            update();
          }
          if (event.type === 'agent_event') {
            const item = event.event || {};
            agentEvents = [...agentEvents, item];
            if (item.type === 'plan_created' && item.plan) agentPlan = item.plan;
            if (item.type === 'task_updated' && item.plan) agentPlan = item.plan;
            if (item.type === 'self_correction') { setStatus('Recovering from an error…'); setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: item.summary || 'Recovering from an issue…', lastActivityAt: Date.now() })); }
            else if (item.type === 'agent_started') { setStatus('Planning…'); setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: 'Registering plans...', lastActivityAt: Date.now() })); }
            else if (item.type === 'plan_created') setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: 'Registering plans...', lastActivityAt: Date.now() }));
            else if (item.type === 'task_updated' && item.task) setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: item.task.status === 'completed' ? `Completed: ${item.task.title}` : item.task.status === 'running' ? `Working on: ${item.task.title}` : `Updating: ${item.task.title}`, lastActivityAt: Date.now() }));
            else if (item.type === 'tool_started') setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: item.progressTarget ? (item.name === 'web_search' ? `Searching for ${item.progressTarget}...` : `Fetching URL ${item.progressTarget}...`) : item.name === 'generate_image' ? 'Generating image...' : item.name === 'fetch_public_url' ? 'Fetching requested URL...' : item.name === 'web_search' ? 'Searching the web...' : item.name === 'create_task_plan' ? 'Registering plans...' : item.name === 'update_task_status' ? 'Marking task progress...' : item.name === 'execute_python' ? 'Working on requested files...' : `Using ${toolDisplayName(item.name)}...`, lastActivityAt: Date.now() }));
            else if (item.type === 'tool_completed') setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: item.name === 'generate_image' ? 'The image is ready. I’m checking the result...' : item.name === 'execute_python' ? 'The code finished. I’m verifying the output...' : 'The tool finished. I’m checking its results...', lastActivityAt: Date.now() }));
            update();
          }
          if (event.type === 'tool_start') {
            events = [
              ...events,
              {
                name: event.name,
                status: 'running',
                arguments: event.arguments,
              },
            ];
            setStatus(`Using ${event.name.replaceAll('_', ' ')}…`);
            setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: toolProgressMessage(event.name, event.arguments), lastActivityAt: Date.now() }));
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
                    }
                  : x
              );
            setLiveProgress((current) => ({ ...(current || { startedAt: Date.now() }), message: 'I’m verifying the results...', lastActivityAt: Date.now() }));
            update();
          }
          if (event.type === 'done') {
            usage = event.usage || usage;
            durationMs = event.durationMs ?? Math.round(performance.now() - started);
            update();
          }
          if (event.type === 'stopped') setStatus('Stopped');
          if (event.type === 'error') throw new Error(event.error || 'Generation failed.');
        }
        if (chunk.done) break;
      }
      liveAssistant = {
        ...assistant,
        content: output || '(No text was returned.)',
        isStreaming: false,
        toolEvents: events,
        agentPlan,
        agentEvents,
        usage,
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
        isStreaming: false,
        toolEvents: events,
        agentPlan,
        agentEvents,
        error: stopped ? 'Generation stopped.' : error.message,
        usage,
        durationMs: durationMs ?? Math.round(performance.now() - started),
      };
      if (activeIdRef.current === chat._id)
        setMessages((current) => current.map((m) => (m.id === assistantId ? liveAssistant : m)));
      setStatus(stopped ? 'Stopped' : 'Request failed');
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
  if (auth.loading)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" /> Loading your workspace…
      </div>
    );
  if (!auth.user) return <LoginScreen providers={auth.providers} error={auth.error} />;

  return (
    <div className="app agent-lab">
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
              <div className="chat-loading">
                <LoaderCircle className="spin" size={18} /> Loading conversation…
              </div>
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
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.shiftKey || e.metaKey)) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={1}
              placeholder="Ask anything, or give your agent a task…"
            />
            <div className="composer-controls">
              <div className="composer-left">
                <button
                  type="button"
                  className="composer-icon"
                  title="Attach images, videos or documents"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip size={17} />
                </button>
                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime,.pdf,.txt,.md,.csv,.tsv,.json,.xml,.zip,.xls,.xlsx,.doc,.docx,.pptx,.py,.js,.jsx,.mjs,.cjs,.ts,.tsx,.html,.css,.sql,.yml,.yaml,.toml,.ini,.cfg,.conf,.log,.sh,.env"
                  multiple
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className={`thinking-control ${thinking ? 'enabled' : ''}`}
                  onClick={() => setThinking((v) => !v)}
                  title="Toggle model thinking"
                >
                  <Brain size={14} />
                  <span>Thinking</span>
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
              <kbd>Enter</kbd> newline · <kbd>Shift + Enter</kbd> send
            </span>
            <span>Agent tools run automatically · Think mode {thinking ? 'on' : 'off'}</span>
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
        onOpenLibrary={() => {
          setDrawer(false);
          setLibraryOpen(true);
        }}
      />
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
        revokeShare={revokeShare}
      />
    </div>
  );
}
