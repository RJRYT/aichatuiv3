import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle, ArrowDown, ArrowUp, Bot, Brain, Check, CheckCircle2, Copy, Download,
  FileImage, Globe, Github, Package, Calculator, Clock, Link as LinkIcon, LoaderCircle,
  LogOut, MessageSquare, Paperclip, PanelLeft, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Square, SquarePen, Trash2, Video, Wrench, X, Pencil,
  UserRound, SlidersHorizontal, ChevronDown, Code2
} from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const DEFAULT_PREFERENCES = { baseStyle: 'friendly', tone: 'balanced', warmth: 3, enthusiasm: 3, emoji: 'moderate', visualAnswers: true, headers: true, lists: true };
const SUGGESTIONS = [
  { icon: Search, label: 'Research a topic', prompt: 'Research the latest developments in AI coding agents. Use web search and cite reliable sources.' },
  { icon: Code2, label: 'Build something', prompt: 'Help me design and implement a production-ready feature. Start by clarifying requirements and proposing an implementation plan.' },
  { icon: Github, label: 'Explore GitHub', prompt: 'Find popular open-source JavaScript repositories for building agentic applications. Compare their features and licenses.' },
  { icon: Sparkles, label: 'Think through an idea', prompt: 'Help me evaluate a product idea. Analyze feasibility, architecture, risks, and an MVP roadmap.' }
];
function api(path) { return `${API_BASE}${path}`; }
async function request(path, options = {}) {
  const response = await fetch(api(path), { credentials: 'include', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  if (!response.ok) { let data = {}; try { data = await response.json(); } catch { data.error = await response.text(); } throw new Error(data.error || `Request failed (${response.status})`); }
  return response;
}
function textOf(content) { return typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p => p.type === 'text').map(p => p.text).join('\n') : ''; }
function dateLabel(value) { return value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''; }
function titleFallback(text) { const value = text.replace(/\s+/g, ' ').trim(); return value.length > 58 ? `${value.slice(0, 58)}…` : value || 'New chat'; }
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }
function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; }); }
async function prepareImage(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} exceeds the 12 MB image limit.`);
  const src = await readFile(file), img = await loadImage(src), scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { name: file.name, type: file.type, dataUrl: canvas.toDataURL('image/jpeg', .84), preview: canvas.toDataURL('image/jpeg', .5) };
}
async function prepareVideo(file) {
  if (file.size > 45 * 1024 * 1024) throw new Error(`${file.name} exceeds the 45 MB video limit.`);
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video'); video.preload = 'auto'; video.muted = true; video.src = url;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const duration = video.duration; if (!duration || !Number.isFinite(duration)) throw new Error(`Cannot decode ${file.name}.`);
    const count = Math.min(6, Math.max(2, Math.ceil(duration / 15))), canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / (video.videoWidth || 1280)); canvas.width = Math.max(1, Math.round((video.videoWidth || 1280) * scale)); canvas.height = Math.max(1, Math.round((video.videoHeight || 720) * scale));
    const ctx = canvas.getContext('2d'), frames = [];
    for (let i = 0; i < count; i++) { const time = Math.min(duration - .05, duration * i / (count - 1)); video.currentTime = Math.max(0, time); await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; }); ctx.drawImage(video, 0, 0, canvas.width, canvas.height); frames.push({ time, dataUrl: canvas.toDataURL('image/jpeg', .78) }); }
    return { name: file.name, type: file.type, frames, duration };
  } finally { URL.revokeObjectURL(url); }
}
async function prepareFiles(files) { const out = []; for (const file of files) { if (file.type.startsWith('image/')) out.push(await prepareImage(file)); else if (file.type.startsWith('video/')) out.push(await prepareVideo(file)); else throw new Error(`Unsupported file: ${file.name}`); } return out; }

function Markdown({ content }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />, pre: ({ node, ...p }) => <pre className="code-block" {...p}/>, code: ({ node, className, children, ...p }) => <code className={className || 'inline-code'} {...p}>{children}</code>, table: ({ node, ...p }) => <div className="table-wrap"><table {...p}/></div> }}>{content || ''}</ReactMarkdown></div>;
}
function PluginIcon({ name, size = 15 }) { const icons = { web_search: Globe, fetch_public_url: LinkIcon, github_search: Github, npm_search: Package, calculator: Calculator, get_current_datetime: Clock, save_memory: Brain, search_memories: Brain }; const Icon = icons[name] || Wrench; return <Icon size={size}/>; }
function ToolActivity({ events = [] }) {
  if (!events.length) return null;
  return <details className="tool-activity" open><summary><Wrench size={13}/> Plugin activity <span>{events.length}</span></summary><div className="tool-list">{events.map((event, i) => <div className={`tool-row ${event.status}`} key={`${event.name}-${i}`}><PluginIcon name={event.name}/><b>{event.name.replaceAll('_', ' ')}</b><span>{event.status === 'complete' ? 'Done' : event.status === 'error' ? event.error || 'Failed' : 'Running'}</span></div>)}</div></details>;
}
function Message({ message, onCopy }) {
  const user = message.role === 'user', content = textOf(message.content);
  return <article className={`message ${user ? 'user-message' : 'assistant-message'}`}>
    <div className={`message-avatar ${user ? 'user-avatar' : ''}`}>{user ? <UserRound size={15}/> : <Bot size={17}/>}</div>
    <div className="message-main"><div className="message-heading"><span>{user ? 'You' : 'Assistant'}</span>{message.createdAt && <time>{dateLabel(message.createdAt)}</time>}{!user && content && <button className="tiny-action" title="Copy response" onClick={() => onCopy(content)}><Copy size={13}/></button>}</div>
      {message.attachments?.length > 0 && <div className="attachment-list">{message.attachments.map((f, i) => <span className="attachment-pill" key={`${f.name}-${i}`}>{f.type?.startsWith('video') ? <Video size={13}/> : <FileImage size={13}/>} {f.name}</span>)}</div>}
      {message.reasoning && <details className="reasoning-block"><summary><Brain size={13}/> Thinking process</summary><div>{message.reasoning}</div></details>}
      {message.toolEvents?.length > 0 && <ToolActivity events={message.toolEvents}/>}
      {content && (user ? <div className="user-text">{content}</div> : <Markdown content={content}/>)}
      {message.error && <div className="message-error"><AlertCircle size={14}/>{message.error}</div>}
      {message.usage && <details className="stats"><summary>Response details</summary><div>{message.usage.prompt_tokens != null && <span>Input {Number(message.usage.prompt_tokens).toLocaleString()}</span>}{message.usage.completion_tokens != null && <span>Output {Number(message.usage.completion_tokens).toLocaleString()}</span>}{message.durationMs != null && <span>{(message.durationMs / 1000).toFixed(1)}s</span>}</div></details>}
    </div>
  </article>;
}
function LoginScreen({ providers, error }) {
  const labels = { google: 'Continue with Google', github: 'Continue with GitHub', discord: 'Continue with Discord' };
  const icons = { google: 'G', github: '⌘', discord: '◉' };
  return <div className="login-page"><div className="login-card"><div className="brand-mark large">✦</div><p className="eyebrow">AGENT LAB</p><h1>Your workspace,<br/><em>your agent.</em></h1><p className="login-sub">Sign in to access your conversations, saved memories and personal preferences.</p>{error && <div className="notice error-notice">{error}</div>}<div className="oauth-list">{Object.keys(labels).map(provider => <a className={`oauth-button ${providers?.[provider] ? '' : 'disabled'}`} href={providers?.[provider] ? api(`/api/auth/${provider}`) : undefined} key={provider} onClick={e => !providers?.[provider] && e.preventDefault()}><b>{icons[provider]}</b>{labels[provider]}{!providers?.[provider] && <small>Not configured</small>}</a>)}</div><p className="login-foot"><ShieldCheck size={13}/> Your account data is private and tied to your sign-in.</p></div></div>;
}
function HistoryDrawer({ open, onClose, chats, activeId, onSelect, onNew, onDelete }) {
  if (!open) return null;
  return <div className="drawer-layer" onMouseDown={onClose}><aside className="history-drawer" onMouseDown={e => e.stopPropagation()}><div className="drawer-head"><div><b>Conversations</b><small>{chats.length} saved</small></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><button className="new-chat-button" onClick={onNew}><Plus size={15}/> New conversation</button><div className="history-list">{chats.map(chat => <div className={`history-item ${chat._id === activeId ? 'active' : ''}`} key={chat._id}><button className="history-select" onClick={() => onSelect(chat._id)}><MessageSquare size={15}/><span><b>{chat.title || 'New chat'}</b><small>{dateLabel(chat.updatedAt)}</small></span></button><button className="delete-chat" onClick={() => onDelete(chat._id)} title="Delete"><Trash2 size={14}/></button></div>)}{!chats.length && <p className="empty-history">No conversations yet.</p>}</div></aside></div>;
}
function PreferencesDialog({ open, onClose, preferences, setPreferences, memories, addMemory, editMemory, deleteMemory, user, logout }) {
  const [tab, setTab] = useState('personalization'), [draft, setDraft] = useState(''), [editing, setEditing] = useState(null);
  useEffect(() => { if (open) { setTab('personalization'); setDraft(''); setEditing(null); } }, [open]);
  if (!open) return null;
  const update = (key, value) => setPreferences(p => ({ ...p, [key]: value }));
  const saveMemory = async () => { if (!draft.trim()) return; if (editing) await editMemory(editing, draft.trim()); else await addMemory(draft.trim()); setDraft(''); setEditing(null); };
  return <div className="modal-layer" onMouseDown={onClose}><section className="preferences-modal" onMouseDown={e => e.stopPropagation()}>
    <header className="modal-head"><div><div className="eyebrow">YOUR ACCOUNT</div><h2>Personalization</h2><p>Shape how your assistant communicates and remembers context.</p></div><button className="icon-button" onClick={onClose}><X size={18}/></button></header>
    <div className="account-strip">{user?.avatar ? <img src={user.avatar} onError={e => { e.currentTarget.style.display = 'none'; }} alt=""/> : <span className="account-avatar-fallback"><UserRound size={15}/></span>}<div><b>{user?.name || 'Account'}</b><small>{user?.email || user?.provider}</small></div><button className="secondary-button compact" onClick={logout}><LogOut size={13}/> Sign out</button></div>
    <div className="tab-row"><button className={tab === 'personalization' ? 'selected' : ''} onClick={() => setTab('personalization')}><SlidersHorizontal size={14}/> Personalization</button><button className={tab === 'memories' ? 'selected' : ''} onClick={() => setTab('memories')}><Brain size={14}/> Manage memory <span>{memories.length}</span></button></div>
    {tab === 'personalization' ? <div className="preference-grid">
      <label>Base style<select value={preferences.baseStyle} onChange={e => update('baseStyle', e.target.value)}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="efficient">Efficient</option><option value="academic">Academic</option><option value="creative">Creative</option><option value="direct">Direct</option></select></label>
      <label>Base tone<select value={preferences.tone} onChange={e => update('tone', e.target.value)}><option value="balanced">Balanced</option><option value="casual">Casual</option><option value="formal">Formal</option><option value="empathetic">Empathetic</option><option value="technical">Technical</option><option value="playful">Playful</option></select></label>
      <label>Warmth <output>{preferences.warmth}/5</output><input type="range" min="1" max="5" value={preferences.warmth} onChange={e => update('warmth', Number(e.target.value))}/></label>
      <label>Enthusiasm <output>{preferences.enthusiasm}/5</output><input type="range" min="1" max="5" value={preferences.enthusiasm} onChange={e => update('enthusiasm', Number(e.target.value))}/></label>
      <label>Emoji usage<select value={preferences.emoji} onChange={e => update('emoji', e.target.value)}><option value="none">None</option><option value="minimal">Minimal</option><option value="moderate">Moderate</option><option value="expressive">Expressive</option></select></label>
      <div className="preference-toggles"><Toggle label="Visual answers when useful" value={preferences.visualAnswers} onChange={v => update('visualAnswers', v)}/><Toggle label="Use headers" value={preferences.headers} onChange={v => update('headers', v)}/><Toggle label="Use lists" value={preferences.lists} onChange={v => update('lists', v)}/></div>
    </div> : <div className="memory-manager"><div className="memory-intro"><b>Saved memories</b><p>Information saved here can be used to personalize future conversations. Avoid storing secrets.</p></div><div className="memory-add"><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add something you want the assistant to remember…" rows={2}/><div><button className="secondary-button compact" onClick={() => { setDraft(''); setEditing(null); }}>Clear</button><button className="primary-button compact" onClick={saveMemory} disabled={!draft.trim()}>{editing ? 'Save change' : 'Add memory'}</button></div></div><div className="memory-list">{memories.map(memory => <div className="memory-item" key={memory._id}><p>{memory.text}</p><div><button className="tiny-action" title="Edit" onClick={() => { setEditing(memory._id); setDraft(memory.text); }}><Pencil size={13}/></button><button className="tiny-action danger-text" title="Delete" onClick={() => deleteMemory(memory._id)}><Trash2 size={13}/></button></div></div>)}{!memories.length && <div className="empty-history">No saved memories yet.</div>}</div></div>}
    <footer className="modal-foot"><span className="save-hint">Changes save automatically.</span><button className="primary-button" onClick={onClose}><Check size={15}/> Done</button></footer>
  </section></div>;
}
function Toggle({ label, value, onChange }) { return <label className="toggle-row"><span>{label}</span><button type="button" role="switch" aria-checked={value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i/></button></label>; }

export default function App() {
  const [auth, setAuth] = useState({ loading: true, user: null, providers: {}, error: '' });
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES), [memories, setMemories] = useState([]), [plugins, setPlugins] = useState([]);
  const [chats, setChats] = useState([]), [activeId, setActiveId] = useState(null), [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('Ready'), [drawer, setDrawer] = useState(false), [prefsOpen, setPrefsOpen] = useState(false);
  const [input, setInput] = useState(''), [files, setFiles] = useState([]), [fileError, setFileError] = useState(''), [thinking, setThinking] = useState(true), [pluginMenu, setPluginMenu] = useState(false), [scrollDown, setScrollDown] = useState(false);
  const scrollRef = useRef(null), textareaRef = useRef(null), fileRef = useRef(null), abortRef = useRef(null), pluginRef = useRef(null);
  const activeChat = useMemo(() => chats.find(c => c._id === activeId), [chats, activeId]);

  const loadAccount = useCallback(async () => {
    try {
      const [meRes, healthRes] = await Promise.all([request('/api/auth/me'), request('/api/health')]);
      const me = await meRes.json(), health = await healthRes.json();
      if (!me.user) { setAuth({ loading: false, user: null, providers: health.oauth || {}, error: new URLSearchParams(location.search).get('auth_error') || '' }); return; }
      setAuth({ loading: false, user: me.user, providers: health.oauth || {}, error: '' });
      const [prefRes, memoryRes, pluginRes] = await Promise.all([request('/api/account/preferences'), request('/api/account/memories'), request('/api/plugins')]);
      const [pref, memory, plugin] = await Promise.all([prefRes.json(), memoryRes.json(), pluginRes.json()]);
      setPreferences({ ...DEFAULT_PREFERENCES, ...pref.preferences }); setMemories(memory.memories || []); setPlugins(plugin.plugins || []);
      const chatRes = await request('/api/chats'); const data = await chatRes.json(); setChats(data.chats || []);
      if (data.chats?.length) { setActiveId(data.chats[0]._id); setMessages(data.chats[0].messages || []); }
      else await newChat();
    } catch (error) {
      if (error.message === 'Authentication required.') { try { const h = await (await request('/api/health')).json(); setAuth({ loading: false, user: null, providers: h.oauth || {}, error: '' }); } catch { setAuth({ loading: false, user: null, providers: {}, error: error.message }); } }
      else setAuth(a => ({ ...a, loading: false, error: error.message }));
    }
  }, []);
  useEffect(() => { loadAccount(); }, [loadAccount]);
  useEffect(() => { const close = e => { if (pluginRef.current && !pluginRef.current.contains(e.target)) setPluginMenu(false); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  useEffect(() => { if (scrollRef.current) { const el = scrollRef.current; if (el.scrollHeight - el.scrollTop - el.clientHeight < 260) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); } }, [messages]);

  const newChat = async () => {
    const res = await request('/api/chats', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) }); const { chat } = await res.json();
    setChats(current => [chat, ...current]); setActiveId(chat._id); setMessages([]); setInput(''); setFiles([]); setDrawer(false); return chat;
  };
  const selectChat = async id => { if (busy) return; const res = await request(`/api/chats/${id}`); const { chat } = await res.json(); setActiveId(id); setMessages(chat.messages || []); setDrawer(false); };
  const saveMessages = async (id, next, title) => { const res = await request(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ messages: next, ...(title ? { title } : {}) }) }); const { chat } = await res.json(); setChats(current => [chat, ...current.filter(c => c._id !== chat._id)]); };
  const removeChat = async id => { await request(`/api/chats/${id}`, { method: 'DELETE' }); const next = chats.filter(c => c._id !== id); setChats(next); if (activeId === id) { if (next.length) selectChat(next[0]._id); else { setActiveId(null); setMessages([]); await newChat(); } } };
  const logout = async () => { await request('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
  const savePreferences = async update => { const next = typeof update === 'function' ? update(preferences) : update; setPreferences(next); try { await request('/api/account/preferences', { method: 'PATCH', body: JSON.stringify(next) }); } catch (error) { setFileError(error.message); } };
  const addMemory = async text => { const res = await request('/api/account/memories', { method: 'POST', body: JSON.stringify({ text }) }); const data = await res.json(); setMemories(data.memories || []); };
  const editMemory = async (id, text) => { const res = await request(`/api/account/memories/${id}`, { method: 'PATCH', body: JSON.stringify({ text }) }); const data = await res.json(); setMemories(data.memories || []); };
  const deleteMemory = async id => { const res = await request(`/api/account/memories/${id}`, { method: 'DELETE' }); const data = await res.json(); setMemories(data.memories || []); };
  const generateName = async (id = activeId, source = messages) => {
    if (!id || !source.length) return;
    const first = source.find(m => m.role === 'user'); if (!first) return;
    setStatus('Naming conversation…');
    const res = await request('/api/chat/title', { method: 'POST', body: JSON.stringify({ text: textOf(first.content) }) }); const { title } = await res.json();
    const patch = await request(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); const { chat } = await patch.json();
    setChats(current => [chat, ...current.filter(c => c._id !== id)]); setStatus('Ready');
  };
  const copyText = async text => { try { await navigator.clipboard.writeText(text); setStatus('Copied'); } catch { setStatus('Clipboard unavailable'); } };
  const exportChat = () => { const blob = new Blob([JSON.stringify({ title: activeChat?.title || 'New chat', messages: messages.map(m => ({ role: m.role, content: textOf(m.content), reasoning: m.reasoning, toolEvents: m.toolEvents })) }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'agent-lab-chat.json'; a.click(); URL.revokeObjectURL(url); };
  const sendMessage = async (raw = input, attach = files) => {
    const text = String(raw || '').trim(); if ((!text && !attach.length) || busy) return;
    setFileError(''); setBusy(true); setStatus('Preparing request…');
    let chat = activeChat; if (!chat) { try { chat = await newChat(); } catch (error) { setBusy(false); setFileError(error.message); return; } }
    let prepared = []; try { if (attach.length) prepared = await prepareFiles(attach); } catch (error) { setBusy(false); setFileError(error.message); return; }
    const payloadSize = prepared.reduce((n, item) => n + (item.dataUrl?.length || 0) + (item.frames || []).reduce((s, f) => s + f.dataUrl.length, 0), 0);
    if (payloadSize > 22 * 1024 * 1024) { setBusy(false); setFileError('Compressed attachments exceed the 22 MB request limit.'); return; }
    const parts = []; if (text) parts.push({ type: 'text', text });
    for (const item of prepared) { if (item.dataUrl) parts.push({ type: 'image_url', image_url: { url: item.dataUrl } }); if (item.frames) for (const frame of item.frames) { parts.push({ type: 'text', text: `Video frame at ${frame.time.toFixed(2)} seconds from ${item.name}.` }); parts.push({ type: 'image_url', image_url: { url: frame.dataUrl } }); } }
    const attachments = prepared.map(x => ({ name: x.name, type: x.type }));
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: text || 'Please analyze the attached media.', attachments, createdAt: new Date().toISOString(), ...(prepared.length ? { apiContent: parts } : {}) };
    const nextMessages = [...messages, userMessage], titleBefore = chat.title || 'New chat';
    setMessages(nextMessages); setInput(''); setFiles([]); if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const assistantId = crypto.randomUUID(), assistant = { id: assistantId, role: 'assistant', content: '', reasoning: '', toolEvents: [], createdAt: new Date().toISOString() };
    setMessages([...nextMessages, assistant]); const controller = new AbortController(); abortRef.current = controller; const started = performance.now();
    let output = '', thought = '', events = [], usage = null, durationMs = null, liveAssistant = assistant;
    const update = () => setMessages(current => current.map(m => m.id === assistantId ? { ...liveAssistant, content: output, reasoning: thought, toolEvents: events, usage, durationMs } : m));
    try {
      setStatus('Connecting…');
      const res = await fetch(api('/api/chat/stream'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ chatId: chat._id, thinkingEnabled: thinking, messages: nextMessages.map(m => ({ role: m.role, content: m.apiContent || m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) })) }) });
      if (!res.ok) { let data = {}; try { data = await res.json(); } catch { data.error = await res.text(); } throw new Error(data.error || `Request failed (${res.status})`); }
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || '';
        for (const block of blocks) {
          const line = block.split(/\r?\n/).find(x => x.startsWith('data:')); if (!line) continue;
          let event; try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (event.type === 'status') setStatus(event.status || 'Working…');
          if (event.type === 'chunk') { output += event.content || ''; setStatus('Generating…'); update(); }
          if (event.type === 'reasoning') { thought += event.content || ''; update(); }
          if (event.type === 'tool_start') { events = [...events, { name: event.name, status: 'running', arguments: event.arguments }]; setStatus(`Using ${event.name.replaceAll('_', ' ')}…`); update(); }
          if (event.type === 'tool_result') { const index = events.map(x => x.name).lastIndexOf(event.name); if (index >= 0) events = events.map((x, i) => i === index ? { ...x, status: event.status, error: event.error, result: event.result } : x); update(); }
          if (event.type === 'done') { usage = event.usage || usage; durationMs = event.durationMs ?? Math.round(performance.now() - started); update(); }
          if (event.type === 'stopped') setStatus('Stopped');
          if (event.type === 'error') throw new Error(event.error || 'Generation failed.');
        }
        if (chunk.done) break;
      }
      if (!output && thought) output = '(The model returned thinking but no final answer.)';
      liveAssistant = { ...assistant, content: output || '(No text was returned.)', reasoning: thought, toolEvents: events, usage, durationMs };
      const saved = [...nextMessages, liveAssistant]; setMessages(saved); await saveMessages(chat._id, saved);
      if (titleBefore === 'New chat') { try { await generateName(chat._id, saved); } catch { const fallback = titleFallback(text || attachments[0]?.name || 'New chat'); await request(`/api/chats/${chat._id}`, { method: 'PATCH', body: JSON.stringify({ title: fallback }) }); setChats(current => current.map(c => c._id === chat._id ? { ...c, title: fallback } : c)); } }
      setStatus('Ready');
    } catch (error) {
      const stopped = error.name === 'AbortError'; liveAssistant = { ...assistant, content: output, reasoning: thought, toolEvents: events, error: stopped ? 'Generation stopped.' : error.message, usage, durationMs: durationMs ?? Math.round(performance.now() - started) };
      setMessages(current => current.map(m => m.id === assistantId ? liveAssistant : m)); setStatus(stopped ? 'Stopped' : 'Request failed'); try { await saveMessages(chat._id, [...nextMessages, liveAssistant]); } catch { /* display generation error */ }
    } finally { abortRef.current = null; setBusy(false); }
  };
  const addFiles = fileList => { const next = [...fileList]; if (files.length + next.length > 6) { setFileError('Maximum 6 attachments per message.'); return; } setFiles(current => [...current, ...next]); };
  const onScroll = () => { const el = scrollRef.current; if (el) setScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 240); };

  if (auth.loading) return <div className="loading-screen"><LoaderCircle className="spin"/> Loading your workspace…</div>;
  if (!auth.user) return <LoginScreen providers={auth.providers} error={auth.error}/>;

  return <div className="app agent-lab">
    <header className="topbar"><div className="brand-area"><button className="icon-button" title="Conversation history" onClick={() => setDrawer(true)}><PanelLeft size={17}/></button><div className="brand-mark">✦</div><div className="brand-text"><b>Agent Lab</b><small>PERSONAL WORKSPACE</small></div></div>
      <div className="top-actions"><span className="status-label"><i className={busy ? 'pulse-dot' : 'ready-dot'}/>{status}</span><button className="icon-button" title="Generate chat name" onClick={() => generateName()} disabled={!messages.length || busy}><Sparkles size={16}/></button><button className="icon-button" title="Export conversation" onClick={exportChat}><Download size={16}/></button><button className="icon-button" title="Personalization & memory" onClick={() => setPrefsOpen(true)}><Settings2 size={17}/></button><button className="icon-button" title="New chat" onClick={newChat} disabled={busy}><SquarePen size={17}/></button>{busy && <button className="icon-button stop-button" title="Stop" onClick={() => abortRef.current?.abort()}><Square size={14}/></button>}<button className="profile-button" title={auth.user.name} onClick={() => setPrefsOpen(true)}>{auth.user.avatar ? <img src={auth.user.avatar} alt=""/> : <UserRound size={16}/>}</button></div>
    </header>
    <main className="workspace"><div className="workspace-top"><div><div className="eyebrow">AGENT WORKSPACE</div><h1>{activeChat?.title && activeChat.title !== 'New chat' ? activeChat.title : 'What are we working on?'}</h1><p>Research, create, explore and solve problems with tools.</p></div><button className="text-action" onClick={() => setDrawer(true)}><MessageSquare size={14}/> History</button></div>
      <section className="chat-scroll" ref={scrollRef} onScroll={onScroll}><div className="chat-inner">{messages.length === 0 ? <div className="welcome"><div className="welcome-symbol"><Sparkles size={23}/></div><div className="eyebrow">READY WHEN YOU ARE</div><h2>Let's make<br/><em>something happen.</em></h2><p>Ask a question, research the web, work through code or explore an idea. Your plugins are ready when needed.</p><div className="suggestions">{SUGGESTIONS.map(({ icon: Icon, label, prompt }) => <button key={label} onClick={() => setInput(prompt)}><Icon size={15}/><span>{label}</span><ArrowUp size={13}/></button>)}</div></div> : messages.map(m => <Message key={m.id || `${m.role}-${m.createdAt}`} message={m} onCopy={copyText}/>)}</div>{scrollDown && <button className="scroll-bottom" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}><ArrowDown size={15}/></button>}</section>
      <div className="composer-area">{fileError && <div className="attachment-error"><AlertCircle size={13}/>{fileError}<button onClick={() => setFileError('')}><X size={13}/></button></div>}{files.length > 0 && <div className="pending-files">{files.map((f, i) => <div className="pending-file" key={`${f.name}-${i}`}>{f.type.startsWith('video') ? <Video size={13}/> : <FileImage size={13}/>}<span>{f.name}</span><button onClick={() => setFiles(current => current.filter((_, n) => n !== i))}><X size={12}/></button></div>)}</div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); sendMessage(); }}><textarea ref={textareaRef} value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} rows={1} placeholder="Ask anything, or give your agent a task…"/>
          <div className="composer-controls"><div className="composer-left"><button type="button" className="composer-icon" title="Attach images or videos" onClick={() => fileRef.current?.click()}><Paperclip size={17}/></button><input ref={fileRef} hidden type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }}/>
            <div className="plugin-anchor" ref={pluginRef}><button type="button" className={`composer-icon ${pluginMenu ? 'active' : ''}`} title="Plugins" onClick={() => setPluginMenu(v => !v)}><Wrench size={17}/><ChevronDown size={10}/></button>{pluginMenu && <div className="plugin-dropup"><div className="plugin-drop-head"><b>Available plugins</b><span>{plugins.length} active</span></div>{plugins.map(plugin => <div className="plugin-entry" key={plugin.id}><span className="plugin-entry-icon"><PluginIcon name={plugin.id}/></span><span><b>{plugin.name}</b><small>{plugin.description}</small></span><i className={plugin.configured ? 'configured' : 'not-configured'} title={plugin.configured ? 'Ready' : 'Needs API key'}/></div>)}<p>Plugins are selected automatically by the agent when useful.</p></div>}</div>
            <button type="button" className={`thinking-control ${thinking ? 'enabled' : ''}`} onClick={() => setThinking(v => !v)} title="Toggle model thinking"><Brain size={14}/><span>Thinking</span><i/></button>
          </div><button className="send-button" type="submit" disabled={busy || (!input.trim() && !files.length)}>{busy ? <LoaderCircle size={16} className="spin"/> : <ArrowUp size={17}/>}</button></div></form><div className="composer-caption"><span><kbd>Enter</kbd> send · <kbd>Shift + Enter</kbd> newline</span><span>Plugins run on the server · Think mode {thinking ? 'on' : 'off'}</span></div>
      </div>
    </main>
    <HistoryDrawer open={drawer} onClose={() => setDrawer(false)} chats={chats} activeId={activeId} onSelect={selectChat} onNew={newChat} onDelete={removeChat}/>
    <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} preferences={preferences} setPreferences={savePreferences} memories={memories} addMemory={addMemory} editMemory={editMemory} deleteMemory={deleteMemory} user={auth.user} logout={logout}/>
  </div>;
}
