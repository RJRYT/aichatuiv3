# Project Context

## What this project is

Nemotron Agent Lab is a full-stack AI chat and agent workspace. Users can have persistent conversations, ask the assistant to research or execute multi-step work, manage plans and memories, run Python in an isolated cloud sandbox, generate images, and save/share downloadable artifacts.

## Technology and layout

- **Monorepo:** npm workspaces; root scripts coordinate client and server.
- **Client:** React 19 + Vite in `apps/client`. The main application and chat experience are in `src/App.jsx`; shared visual styles are in `src/styles.css`.
- **Server:** Express 4 + Mongoose in `apps/server/src`.
- **Persistence:** MongoDB stores users, preferences, memories, chats/branches, shares, uploads, and artifact metadata. The chat store can also use an in-memory mode for local tests or configured fallback operation.
- **Model:** NVIDIA Nemotron 3.5 Super VL through NVIDIA NIM's OpenAI-compatible streaming API. The backend owns the API key and tool loop.
- **Python:** `@vercel/sandbox` runs Python 3.14 in an isolated Firecracker microVM. Sandboxes are persistent per user/chat; execution code, timeouts, output limits, artifacts, and uploads are managed under `apps/server/src/services/interpreter`.
- **Other integrations:** Tavily web search and Cloudflare Workers AI image generation.

## Important request flows

### Chat and agent runtime

1. The client sends conversation messages to `POST /api/chat/stream`.
2. The server validates the chat/branch/revision, then `services/nvidia.js` calls NVIDIA NIM and streams Server-Sent Events (SSE) to the client.
3. The model may invoke tools from `services/tools.js`. Multi-step work can create a visible plan, report progress, update task statuses, run Python, search the web, or generate images.
4. The server persists completed assistant messages and metadata to the appropriate chat branch.
5. The client refreshes the chat and renders the plan, progress, response, and generated-file controls.

The client stream reader lives in `apps/client/src/chatStream.js`. It parses SSE, surfaces structured or plain-text HTTP errors, rejects incomplete streams, and applies connection, idle, and whole-turn deadlines. It does not impose a short deadline on the model's first visible text: server heartbeats keep the user informed during extended reasoning. Chat and regeneration flows in `App.jsx` use the same reader.

### Plans and file deliverables

- Plans have stable task IDs and explicit pending/running/completed/failed/skipped states. Completed plans should not be carried forward as active plans for later unrelated tasks.
- Multi-file project deliverables are implemented in the sandbox and packaged into a ZIP. When archive-only delivery applies, packaged source files should not also be stored as separate File Library entries.
- Deliverables are checked server-side; the assistant must not claim success unless expected artifacts exist and pass validation.
- Re-saving a file with an existing library name adds a numeric suffix (for example `filename-1.ext`).

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
- `apps/server/src/services/nvidia.js` — model streaming, agent/tool loop, limits, timeouts, progress events, and deliverable verification.
- `apps/server/src/services/tools.js` — tool definitions and dispatch.
- `apps/server/src/services/agentPlanning.js` and `agentPlanProgress.js` — plan validation and execution-state transitions.
- `apps/server/src/services/chatStore.js` and `conversationBranches.js` — chat persistence and branch behavior.
- `apps/server/src/services/interpreter/` — sandbox, execution queue/schemas, upload storage, and artifact storage.
- `apps/server/src/services/deliverablePolicy.js` — deliverable/archive detection and ZIP/website checks.
- `apps/server/src/models/` — Mongoose models.
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
- Optional `TAVILY_API_KEY` and Cloudflare Workers AI credentials.

Production deployments should use HTTPS, explicit trusted CORS origins, a strong session secret, and backend-only credentials.

## Recent behavior changes and debugging notes

- Fixed stale completed plans influencing a new task and ensured new plans can open in the UI.
- Improved multi-file project creation so the assistant writes complete files through Python, verifies the project, and delivers a ZIP as the single chat attachment.
- ZIP-required projects are verified only after an execution produces a ZIP candidate. The final assistant response should summarize the verified archive name, its included-file manifest, and the checks that passed; it should not deliver the source files individually.
- A follow-up such as “give me the ZIP” must still be recognized as a file-deliverable request. If missed, Python runs can save every project source file as separate library items and the model may emit a literal `<attachment>…</attachment>` tag. Successful verified ZIP handling now removes only same-chat library files whose exact relative paths are included in that ZIP, and strips model-authored attachment tags; the app's tool artifact UI provides the actual download. The File Library itself is account-wide, so unrelated files from other chats remain visible.
- The latest budget-tracker export's early incomplete turns show a Python `NameError` (`project_root` undefined) and repeated invalid `update_task_status` calls against already-completed tasks. Those tool/planning errors explain the unfinished-plan responses; the export does not contain raw model stream diagnostics, so it cannot establish a provider/network stream interruption. The final ZIP turn completed with all planned tasks and the saved response was complete, but included a literal attachment tag.
- Added duplicate artifact filename suffixes.
- Added timestamps, tool/assistant durations, and work-time totals to exported chat JSON.
- Export inspection found a turn whose `execute_python` event remained `running` for over 16 minutes without a tool result. Sandbox cancellation now propagates through startup and lock waits, and stopping a sandbox is bounded.
- The initial timeout policy was adjusted after feedback that valid model reasoning may take several minutes. There is no longer a short first-visible-output deadline. Model rounds may run for up to 10 minutes, provided the upstream stream continues sending data; 90 seconds without upstream stream data still aborts the model request.
- Client chat streams have a 110-second connection deadline, a 100-second no-SSE-data deadline, and a 16-minute overall client limit. The client accepts server heartbeat events while the model reasons and shows activity rather than treating a lack of visible answer text as failure.
- The server sends model-wait heartbeats and periodic heartbeats while tools run. A heartbeat alone does not extend the server-side model idle timer: when the upstream model stream is silent for 90 seconds, the server sends an explicit error. The server chat-turn cap remains 15 minutes.

## Current worktree and validation caveats

The worktree may contain changes from multiple recent fixes. Check `git status --short` before editing, and preserve unrelated staged or unstaged work.

At the last validation, focused chat-stream/model-timeout/sandbox tests passed and the client production build succeeded. The full test suite also has two pre-existing failures in source-text assertions: `authReliability.test.js` expects a particular optional-auth expression, and `clientRoutes.test.js` expects a light-theme CSS selector. The client build reports an existing CSS minifier warning around an `@media` rule. Re-run checks before relying on these results because the project can change.
