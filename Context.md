# Project Context

## What this project is

Nemotron Agent Lab is a full-stack AI chat and agent workspace. Users can have persistent conversations, ask the assistant to research or execute multi-step work, manage plans and memories, run Python in an isolated cloud sandbox, generate images, and save/share downloadable artifacts.

## Technology and layout

- **Monorepo:** npm workspaces; root scripts coordinate client and server.
- **Client:** React 19 + Vite in `apps/client`. The main application and chat experience are in `src/App.jsx`; shared visual styles are in `src/styles.css`.
- **Server:** Express 4 + Mongoose in `apps/server/src`.
- **Persistence:** MongoDB stores users, preferences, memories, chats/branches, shares, uploads, and artifact metadata. The chat store can also use an in-memory mode for local tests or configured fallback operation.
- **Model:** NVIDIA Nemotron 3.5 Super VL through NVIDIA NIM's OpenAI-compatible streaming API. The backend owns the API key and model-directed tool loop.
- **Agent checkpoints:** MongoDB stores run status, plan snapshots, recent operation summaries, budgets, and interruption details in `AgentRun`.
- **Python:** `@vercel/sandbox` runs Python 3.14 in an isolated Firecracker microVM. Sandboxes are persistent per user/chat; execution code, timeouts, output limits, artifacts, and uploads are managed under `apps/server/src/services/interpreter`.
- **Other integrations:** Tavily web search, Cloudflare Workers AI image generation, and Vercel Sandbox. Developer Mode supports user-owned encrypted credentials for NVIDIA, Tavily, Cloudflare and Vercel; platform environment credentials remain defaults.

## Important request flows

### Chat and agent runtime

1. The client sends conversation messages to `POST /api/chat/stream`.
2. The server validates the chat/branch/revision, then `services/nvidia.js` calls NVIDIA NIM and streams Server-Sent Events (SSE) to the client.
3. Nemotron selects tools from `services/tools.js` using automatic tool choice. Planning and progress reporting are optional model-selected capabilities. Native workspace operations handle project files; isolated runtimes are used only when code execution is needed.
4. The server persists completed assistant messages and metadata to the appropriate chat branch.
5. The client refreshes the chat and renders the plan, progress, response, and generated-file controls.

The client stream reader lives in `apps/client/src/chatStream.js`. It parses SSE, surfaces structured or plain-text HTTP errors, rejects incomplete streams, and applies connection, idle, and whole-turn deadlines. It does not impose a short deadline on the model's first visible text: server heartbeats keep the user informed during extended reasoning. Chat and regeneration flows in `App.jsx` use the same reader.

### Plans and workspaces

- Plans are optional and model-directed. They have stable task IDs and explicit pending/running/completed/failed/skipped states.
- Native workspace files are scoped by owner and conversation and stored in MongoDB. Files support listing, reading, creation, revision-aware editing, deletion, searching, status, and optional ZIP packaging.
- Ordinary project file creation does not start Python. The model may select Python or Node.js execution when actual code execution, builds, tests, or computation are required.
- ZIP archives are created only when requested or genuinely necessary and are independently checked for archive integrity before storage.
- Re-saving a File Library artifact with an existing name adds a numeric suffix (for example `filename-1.ext`).

### Python execution and artifacts

- The client sends an execution request through the agent tool loop or `POST /api/interpreter/execute`.
- The server runs the supplied source in the conversation's isolated, persistent sandbox and collects supported output files into the user's File Library.
- Python dependencies are checked before execution; known common packages can be installed automatically.
- Sandbox access requires Vercel credentials (or Vercel project OIDC). Configuration is documented in `.env.example`.
- Cancellation signals should reach sandbox creation, commands, and lock waits. A chat's sandbox lock serializes access to its persistent workspace.

### Chat export

Chat export downloads JSON using the chat title as a lowercase, hyphenated filename. Export metadata includes chat/message timestamps, elapsed wall time, assistant/tool durations, tool events, agent events, plans, and response versions. For an active turn, elapsed and running durations are measured through export time.

## Key code locations

- `apps/client/src/App.jsx` — chat UI, state, stream consumption, plans, export integration, library controls.
- `apps/client/src/chatStream.js` — shared SSE reader, stream/connection deadlines, HTTP error parsing, user-facing network errors.
- `apps/client/src/chatExport.js` — export JSON construction, elapsed/work-time calculations, export filename normalization.
- `apps/client/src/styles.css` — application styles and responsive layouts.
- `apps/server/src/server.js` — environment loading, middleware, authentication boundaries, route registration, static serving, and error handling.
- `apps/server/src/routes/chat.js` — chat streaming endpoint and persistence merge.
- `apps/server/src/routes/chats.js` — chat CRUD, branches, uploads, and response versions.
- `apps/server/src/routes/interpreter.js` — execution, cancellation, status, and artifact API.
- `apps/server/src/services/nvidia.js` — model streaming, per-request model selection, model-round usage aggregation, model-directed tool loop, bounded execution/recovery budgets, timeouts, and lifecycle events.
- `apps/server/src/services/modelRegistry.js` and `modelRouter.js` — Nemotron aliases, capability metadata, Auto classification and escalation policy.
- `apps/server/src/services/integrations/crypto.js` — AES-256-GCM user credential encryption/decryption.
- `apps/server/src/services/usageAnalytics.js` — full-chat token, request, model and tool usage aggregation.
- `apps/server/src/services/tools.js` — tool definitions and dispatch.
- `apps/server/src/services/agentPlanning.js` — model-directed plan validation and task-state transitions.
- `apps/server/src/services/chatStore.js` and `conversationBranches.js` — chat persistence and branch behavior.
- `apps/server/src/services/interpreter/` — Python sandbox, execution queue/schemas, upload storage, and artifact storage. The sandbox manager also provides the optional isolated Node.js command runtime.
- `apps/server/src/services/archiveValidation.js` — ZIP integrity inspection and archive metadata helpers.
- `apps/server/src/services/workspace/workspaceManager.js` — persistent per-conversation text workspace and ZIP packaging.
- `apps/server/src/models/WorkspaceFile.js` — MongoDB workspace file metadata and content.
- `apps/server/src/models/` — Mongoose models, including `WorkspaceFile` and `AgentRun`.
- `apps/server/src/services/agents/checkpointManager.js` — persisted agent-run checkpoints and interruption recovery context.
- `apps/server/test/` — Node test-runner coverage for routes, agent behavior, persistence, deliverables, sandbox execution, and stream timeouts.

## Development and verification

Requirements: Node.js `>=20.19.0` and npm. Install workspace dependencies with `npm install`.

```powershell
npm run dev       # starts API and client
npm run build     # production client build
npm test          # Node test suite under apps/server/test
npm run format:check
npm run sandbox:check
npm run sandbox:smoke
```

Default development URLs are client `http://localhost:5173` and API `http://localhost:4000`. The app loads `.env` and then `.env.local` from the repository root; never copy real environment values or secrets into documentation, client code, tests, or commits.

## Configuration highlights

Use `.env.example` as the source of truth for available variables. Main backend settings include:

- `NVIDIA_API_KEY` for chat model calls.
- `MONGODB_URI` and `SESSION_SECRET` for persistence and sessions.
- OAuth provider credentials and callback URLs as needed.
- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` for sandbox use outside Vercel; Vercel-hosted deployments can use OIDC.
- `VERCEL_NODE_SANDBOX_IMAGE` to enable the isolated Node.js runtime. The operator must provide and validate an appropriate image.
- Optional `TAVILY_API_KEY` and Cloudflare Workers AI credentials.

Production deployments should use HTTPS, explicit trusted CORS origins, a strong session secret, and backend-only credentials.

## Recent behavior changes and debugging notes

- Fixed stale completed plans influencing a new task and ensured new plans can open in the UI.
- v8 removes regex-driven deliverable classification, forced progress calls, forced Python execution, mandatory project plans, mandatory ZIP packaging, website-specific regex quality gates, and backend-generated final-response overrides.
- Native workspace tools are the default for source-file operations. Python receives a read-only snapshot of non-secret workspace files under `/tmp/nemotron-source`.
- An isolated Node.js runtime is available only when `VERCEL_NODE_SANDBOX_IMAGE` is configured. Node commands run in a separate sandbox; they are never executed in the Express process. Node sandbox changes are not automatically synchronized back into MongoDB workspace files; source edits should use workspace tools.
- ZIP creation is an explicit workspace capability. The backend validates the generated ZIP's central directory, decompression, CRC values, and entry paths before storing it as an artifact.
- The earlier budget-tracker export showed Python file-generation failures and rigid plan/status requirements. The v8 agent loop now returns tool diagnostics to the model and permits strategy changes rather than forcing a fixed tool sequence.
- Added duplicate artifact filename suffixes.
- Added timestamps, tool/assistant durations, and work-time totals to exported chat JSON.
- Export inspection found a turn whose `execute_python` event remained `running` for over 16 minutes without a tool result. Sandbox cancellation now propagates through startup and lock waits, and stopping a sandbox is bounded.
- The initial timeout policy was adjusted after feedback that valid model reasoning may take several minutes. There is no longer a short first-visible-output deadline. Model rounds may run for up to 10 minutes, provided the upstream stream continues sending data; 90 seconds without upstream stream data still aborts the model request.
- Client chat streams have a 110-second connection deadline, a 100-second no-SSE-data deadline, and a 16-minute overall client limit. The client accepts server heartbeat events while the model reasons and shows activity rather than treating a lack of visible answer text as failure.
- The server sends model-wait heartbeats and periodic heartbeats while tools run. A heartbeat alone does not extend the server-side model idle timer: when the upstream model stream is silent for 90 seconds, the server sends an explicit error. The server chat-turn cap remains 15 minutes.

## Current worktree and validation caveats

The worktree may contain changes from multiple recent fixes. Check `git status --short` before editing, and preserve unrelated staged or unstaged work.

For this v8 upgrade, dependency installation could not complete in the build environment, so the full dependency-backed test suite and Vite production build remain unverified. Dependency-free architecture, archive-validation, and system-prompt tests were run separately. Re-run `npm ci`, `npm test`, and `npm run build` in the target development environment before deployment.


## v8.2.0 additions

- Model selector preference is stored as `preferences.activeModel` (`auto` by default).
- Auto routing runs before the main agent loop and emits `model_selected` / `model_switch` events. The router's Bolt usage is included in the assistant usage totals.
- Manual model mode never escalates. Auto escalation is bounded to one switch per turn.
- Personal Integrations are encrypted in the `User.integrations` field. Generate a 32-byte key and set `USER_INTEGRATIONS_ENCRYPTION_KEY`; never rotate it without re-encrypting stored credentials.
- Hidden Developer Mode is revealed by clicking the Personalization heading seven times.
- Tool permissions are configurable only for Python, Node.js, web search, image generation, workspace deletion and ZIP packaging. Core tools and low-risk lookups are always enabled.
- Usage endpoint `/api/chats/usage` hydrates full chats rather than relying on index rows. Historical v8.1 usage values may undercount agent turns with multiple model rounds.

## v8.3.0 personality customization

- Personalization settings now include behavior-focused assistant personas: Nemi Agent (default), Principal Engineer, Patient Mentor, Research Analyst, Direct & Concise, and Creative Partner.
- Users may add up to 1,600 characters of custom personality guidance. It is saved in `User.preferences.personaInstructions` and injected into `buildSystemPrompt` as lower-priority preference context.
- Persona choices are persisted in `User.preferences.persona`; existing accounts use the `agent` default without migration.
- Developer Mode credential inputs now have theme-aware field styling and accessible focus states.


## v8.4.0 personality builder

- Replaced preset-first personality UI with 3 groups: Communication Style, Intellectual Character, and Agent Behavior.
- Slider values are persisted under `User.preferences.personality`: professionalism, friendliness, humor, directness, explanatoryDepth, criticalThinking, creativity, confidence, curiosity, analyticalDepth, autonomy, initiative, empathy, thoroughness, riskTolerance, and intensity.
- `buildSystemPrompt` translates slider values into bounded behavioral guidance. Intensity interpolates each trait toward neutral at 0%; 100% expresses the configured trait fully.
- UI includes quick starts, live summary, reset, optional custom instructions, up to 12 local saved profiles, and JSON import/export.
- High autonomy and risk tolerance do not bypass tool policy, approvals, or safety boundaries.


## v8.4.1 unified persona settings

Personalization UI order is Color theme, then Agent personality. Base style, Base tone, Warmth, Enthusiasm, Emoji usage, Visual answers when useful, Use headers, and Use lists are now controls inside Agent personality and are injected as actionable character/presentation instructions. Named personality profiles and JSON import/export include these presentation preferences.


## v8.4.2 Bolt routing reliability

- Auto routing evaluates recent user-turn context for short follow-ups instead of classifying only the last short message.
- Latest/current information, browsing, web search, explicit tool requests and research are guarded away from Bolt to tool-capable models.
- Manual Bolt mode rejects tasks that require tools with a clear capability message.
- Empty model responses are treated as failures; Auto escalates rather than persisting a generic empty-answer fallback as success.


## v8.5.1 chat lifecycle upgrade
- Workspace directory markers are excluded from file operations; nested directories are inferred from file paths, path collisions are rejected, and directory deletion is recursive.
- Python source snapshots use per-execution temporary roots; runtime snapshots filter legacy markers.
- Workspace ZIPs are extracted into a clean temporary directory and compared against a path/size/SHA-256 manifest before delivery. Project completeness remains unassessed without a project manifest.
- Generation sessions persist SSE events in MongoDB and replay after browser disconnection. Explicit cancellation is separate from transport disconnect. Stale sessions are marked interrupted after 120 seconds without persisted updates; in-flight external model requests cannot resume at exact token position.
- Tool retries are hard-bounded and further dispatch is blocked after exhaustion. Final responses disclose unresolved tool failures.


## v8.5.2 chat UI polish

- Suggested next steps appear only on the latest assistant response in the active conversation.
- Generation elapsed time uses the persisted original start timestamp after refresh and during event replay.
- Single-chat deletion uses switches for optional library/share cleanup and hides each control when no matching resources exist.
- Bulk chat deletion continues to remove all associated resources.
