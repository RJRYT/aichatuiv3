# Nemotron Agent Lab — MERN monorepo

A single-model, Agent Lab interface for NVIDIA Nemotron 3.5 Super VL. The frontend is a static React/Vite build; the Express backend owns model inference, OAuth, web search, plugin execution, personalization and memory. MongoDB persists user accounts, preferences, memories and chats.

## Stack and structure

```text
apps/
  client/     React 19 + Vite static frontend
  server/     Express API + Mongoose + OAuth + agent runtime
```

## Local setup

Requirements: Node.js `^20.19.0` or `>=22.12.0`, npm 10+, MongoDB. `.nvmrc` selects Node.js 22.

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173` · Backend: `http://localhost:4000`.

Configure `NVIDIA_API_KEY`, `MONGODB_URI`, `SESSION_SECRET`, and at least one OAuth provider. Configure Tavily for web search. Create OAuth apps in Google Cloud Console (OAuth Web application), GitHub Developer Settings (OAuth App), and Discord Developer Portal (OAuth2). Add the exact callback URLs below to each provider's authorized redirect/callback URL list:

- Google: `http://localhost:4000/api/auth/google/callback`
- GitHub: `http://localhost:4000/api/auth/github/callback`
- Discord: `http://localhost:4000/api/auth/discord/callback`

For Google, enable the OAuth consent screen and request `openid email profile`. GitHub needs `read:user user:email`. Discord needs `identify email`. Set the corresponding client ID and secret variables in `.env`. The frontend login page only enables providers that have credentials configured.

## Web search

Web search uses Tavily's Search API from the backend. Create a key at https://tavily.com/ and set `TAVILY_API_KEY`. Tavily's Researcher free tier currently advertises 1,000 API credits/month without a credit card; search depth and request type affect credit use. If the key is absent, the Web Search plugin remains visible but reports that server configuration is needed. See https://www.tavily.com/pricing.

The model receives the `web_search` function tool. Search results include source title, URL, snippet and publication date where available. The backend system prompt instructs the agent to cite returned URLs in Markdown.

## Agent behavior

- Agent Lab is the only interface; no layout selector or model selector.
- The model is fixed server-side to `nvidia/nemotron-3.5-super-vl-120b-a12b`.
- All registered tools are supplied to the model automatically. Tool execution is surfaced in the conversation; users do not need to select a tool from the composer.
- The Thinking control toggles `chat_template_kwargs.enable_thinking`. The model's `reasoning_content` is displayed in the message as a collapsible thinking trace.
- Temperature is fixed server-side to NVIDIA's recommended text value (1.0), or 0.6 for visual requests. No max-output-token cap is sent by default; the hosted deployment still enforces its own output/context limits.
- System prompt and initial instructions are backend-managed through `SYSTEM_PROMPT` and `INITIAL_INSTRUCTIONS`.
- Chat names are generated from conversation context. Manually renamed conversations are protected from automatic title replacement.
- Plugins include web search, public URL reading, GitHub search, npm search, calculator, date/time, save memory and search memories.
- Images and video are sent as images and sampled video frames, following the model's multimodal input format.

## Personalization and memory

The account menu includes Profile, Personalization, Manage memory and Shared links. Profiles support an editable display name and unique username. Google, GitHub and Discord identities can be linked to one account from the Profile tab. Memory changes are synchronized across tabs; the agent can save memories only when explicitly asked. Shared response snapshots can be revoked from Shared links.

## Deployment

### One backend host serving the static frontend

```bash
npm run build
npm start
```

Build the React client before starting; Express serves `apps/client/dist` when `SERVE_STATIC=true`.

### Separate static frontend and API host

Build the frontend with the API URL:

```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```

Publish `apps/client/dist` to a static host. On the API host set:

```env
NODE_ENV=production
SERVE_STATIC=false
FRONTEND_URL=https://chat.example.com
API_PUBLIC_URL=https://api.example.com
CORS_ORIGIN=https://chat.example.com
SESSION_SECRET=<long-random-secret>
AUTH_REQUIRED=true
MONGODB_URI=<mongodb-connection-string>
NVIDIA_API_KEY=<nvidia-key>
TAVILY_API_KEY=<tavily-key>
```

Use the production callback URLs `https://api.example.com/api/auth/{google|github|discord}/callback` in each OAuth provider console. Production cookies are Secure and SameSite=None to support a separately hosted frontend. Prefer frontend and API subdomains of the same registrable domain to avoid third-party-cookie restrictions.

## Security

- NVIDIA and Tavily API keys are backend-only. Never use `VITE_` variables for secrets.
- OAuth sessions are signed, HttpOnly cookies. Use a unique high-entropy `SESSION_SECRET` in production (for example, generate one with `openssl rand -base64 48`). The server rejects the example placeholder in production.
- MongoDB is required for OAuth user accounts, saved preferences, memories and persistent chats.
- Chat history is scoped to the authenticated user ID.
- Public URL reading only accepts HTTPS and resolves hostnames before fetching; it rejects private, loopback, link-local and non-public addresses. DNS rebinding defenses and strict outbound egress policy are still recommended for a public deployment.
- Add HTTPS, backups, monitoring and stricter per-user quotas before public use.

## Model reference

Model card: https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b/modelcard
API reference: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-super-vl-120b-a12b

The model card advertises up to 1M context, text/image/video input and configurable thinking. Individual hosted deployments can enforce smaller limits. The agent does not assume that the full advertised context is always available.

## Automatic Python dependency installation (v6.0.3)

The Vercel-managed Python image includes CPython, pip, venv and uv, but does not include Matplotlib or most third-party libraries by default. The execution backend now scans imports before running user code and automatically installs missing, explicitly allowlisted common packages into the conversation `.venv`. This fixes `ModuleNotFoundError: No module named 'matplotlib'` without requiring users or the model to add a manual installation step for common packages. Packages persist in the conversation sandbox snapshot. The default install timeout is 180 seconds and can be changed with `VERCEL_SANDBOX_PACKAGE_INSTALL_TIMEOUT_MS`. Unknown imports are not blindly installed from PyPI; the generated code should explicitly install those packages. Automatic installation requires sandbox network access.

## Vercel Sandbox directory-resume fix (v6.0.2)

Persistent Vercel sandboxes resume from snapshots with their conversation workspace already present. The Vercel SDK `sandbox.mkDir()` operation is not idempotent and can return HTTP 400 (`File exists`) when the application attempts to create that directory again. The provider now uses Linux `mkdir -p -- <absolute-path>` for both the conversation workspace and its `uploads/` directory. This is safe for first creation and repeated resumes. The behavior is covered by a regression test that executes twice against the same conversation sandbox. No environment-variable changes are required for this fix.

## Universal Python execution (Vercel Sandbox)

The model-facing `execute_python` tool now runs full CPython 3.14 in Vercel Sandbox Firecracker microVMs. This is a remote execution service: your Express application stays on its existing Node.js host and calls Vercel through `@vercel/sandbox`. No Python installation, Docker daemon, root access, or second VPS is required on the application host.

### Configure Vercel Sandbox

For an application hosted outside Vercel, create a Vercel project (it can be empty; you do not need to deploy your main app there), create an access token scoped to that team, and obtain the Vercel Team ID and Project ID. Set these backend-only environment variables:

```env
VERCEL_TOKEN=<vercel-access-token>
VERCEL_TEAM_ID=team_...
VERCEL_PROJECT_ID=prj_...
```

On a Vercel deployment, project OIDC authentication can be used instead. Never put these values in `VITE_` variables or send them to the browser. Optional resource settings are documented in `.env.example`. `VERCEL_SANDBOX_PACKAGE_INSTALL_TIMEOUT_MS` controls the maximum time allowed for automatic dependency installation (default 180 seconds). If your app host and users are in India, consider setting `VERCEL_SANDBOX_REGION=bom1` (Mumbai) to reduce execution latency.

Use Node.js 20.19+ (or 22.12+) for the current Sandbox SDK. Install and verify the SDK configuration:

```bash
npm install
npm run sandbox:check
```

To make a real remote sandbox, execute CPython, upload and download a test file, then delete the test sandbox:

```bash
npm run sandbox:smoke
```

### Execution model

- A conversation receives a private persistent sandbox named from the authenticated owner and chat ID. Different accounts and conversations never share a sandbox.
- The sandbox is resumed for each execution and stopped after each tool call. Vercel snapshots the workspace and installed packages on stop, so the VM is not left running idle while files and pip-installed packages persist for later turns (subject to the seven-day snapshot retention configured below).
- The default managed image is `vercel/sandbox/python:3.14`, which provides Python 3.14, pip, venv and uv but does **not** bundle common data-science/document libraries such as Matplotlib. The backend creates a private `.venv` inside each conversation workspace and runs code with that interpreter, avoiding system-Python package-management restrictions. Before each script, the backend statically scans Python imports and automatically installs missing, allowlisted common packages (including `matplotlib`, `numpy`, `pandas`, `scipy`, `seaborn`, `plotly`, `Pillow`, `opencv-python-headless`, `openpyxl`, `reportlab`, `python-docx`, `python-pptx`, `pypdf`, `requests`, `beautifulsoup4`, `lxml`, `PyYAML` and others). Only known import-to-PyPI mappings are installed automatically; unknown packages should be installed explicitly by the code with `subprocess.run([sys.executable, '-m', 'pip', 'install', 'package'], check=True)`. Installations persist within that conversation's sandbox snapshot.
- Uploaded images and supported documents/code files (PDF, TXT/Markdown, CSV/TSV, JSON, XML, ZIP, Excel, Word, PowerPoint, Python, JavaScript/TypeScript, HTML, CSS, SQL, YAML and TOML) are stored per conversation and mounted under `uploads/` in the sandbox. Video is sent to the vision model as sampled frames. Python scripts run in the conversation workspace. Generated regular files outside `uploads/` are discovered after execution, validated and copied into the authenticated user's persistent File Library. Environment files, private-key files and known credential filenames are excluded from automatic artifact collection.
- The top-bar File Library opens a cross-conversation collection with search, safe preview, download and delete actions. It stores file bytes and metadata in MongoDB, not in the ephemeral Node.js host filesystem. Files are private to the owner and survive backend restarts. Generated per-file size is capped at 10 MB; each account has a 50 MB / 100-file generated-artifact quota. Input uploads are capped at 8 MB per file, 20 MB per request, 50 MB per conversation and 100 MB / 100 files per account.
- Execution has per-user and global concurrency limits, a configurable timeout, bounded stdout/stderr, file-count and artifact-size limits, and owner-scoped cancellation.
- The default network policy allows public internet destinations while denying private, loopback, link-local and reserved IP ranges. Set `VERCEL_SANDBOX_NETWORK_MODE=deny-all` to disable sandbox egress; this also disables pip installation and outbound HTTP requests.
- Deleting a conversation also requests deletion of its associated Vercel sandbox and orphan snapshots. File Library items are independent and remain until the owner deletes them.

### API contracts

The model-facing `execute_python` tool and these API routes remain available:

- `POST /api/chats/:id/uploads` stores supported user attachments and returns the safe `uploads/...` paths mounted into that conversation's sandbox.
- `POST /api/interpreter/execute` with `{ "code": "print(1 + 1)", "executionId": "optional-client-id", "chatId": "optional-chat-id" }`
- `POST /api/interpreter/cancel/:id` requests owner-scoped cancellation.
- `GET /api/interpreter/status` reports provider configuration and active executions.
- `GET /api/interpreter/artifacts` lists the signed-in user's File Library.
- `GET /api/interpreter/artifacts/:id` downloads an owner-checked file. `?inline=1` previews supported safe MIME types.
- `DELETE /api/interpreter/artifacts/:id` deletes an owner-owned file.

MongoDB is required for persistent File Library storage. When MongoDB is not configured in development mode, artifacts fall back to process-local memory and will not survive restarts. The Vercel sandbox workspace itself persists independently in Vercel snapshots.

### Cost and plan limits

Vercel Sandbox Hobby usage includes monthly quotas, not unlimited compute. The current published allowances include 5 active CPU-hours, 420 GB-hours of provisioned memory, 5,000 sandbox creations, 20 GB data transfer, 10 concurrent sandboxes, up to 4 vCPUs / 8 GB, and a 45-minute maximum session. Once Hobby quotas are exceeded, new sandbox creation pauses until the next billing cycle. Check the live [Vercel Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing) before production use. Hobby is intended for personal, non-commercial use.

### Security and operational notes

Vercel Sandbox runs code in Firecracker microVMs, but application-level authorization and quotas still matter. Do not expose Vercel credentials to sandbox code. The sandbox network firewall is configured by the backend, and its policy should be reviewed before changing it. The public network is enabled by default for pip installs and internet tasks; private/reserved subnets are denied. Do not pass private service credentials or privileged host capabilities into generated code.

The workspace is conversation-scoped and persistent. It is not an archival backup: Vercel snapshot retention is configured to seven days by default in this project. If a conversation is inactive long enough for its snapshot to expire, its installed packages and working-directory changes may need to be recreated; original user uploads are re-mounted from MongoDB on the next execution. Generated outputs that should remain available are copied to the MongoDB-backed File Library. Keep MongoDB backups and enforce your own retention policy for user files.

## Continuity upgrade — account and conversation architecture

### Database migration

Before deploying this version against an existing MongoDB database, back up the database and run:

```bash
npm run migrate:users
```

The migration backfills `linkedAccounts` from each legacy `{ provider, providerId }` identity, assigns a unique username where missing, assigns stable IDs to legacy messages, and creates a `main` branch from each legacy flat chat message array. It also initializes chat revision metadata for safe optimistic concurrency. It does not merge accounts based on email. Existing records with no trustworthy provider verification remain `emailVerified: false`; users must sign in to an existing account and explicitly link additional providers.

The migration is safe to re-run. Do not remove the legacy `provider` and `providerId` fields yet; they remain as a compatibility identity during the transition. The unique verified-email index only applies to records with `emailVerified: true`.

### OAuth linking

Configure the existing callback URLs for Google, GitHub and Discord. Once signed in, open **Settings → Profile** and choose **Link** beside another provider. The callback validates the signed OAuth state and confirms that the original session still belongs to the same account. Provider identity collisions are rejected. Matching emails are not silently merged.

Provider email verification is sourced from the provider: Google `email_verified`, GitHub primary verified email (or another verified email), and Discord `verified`. An unverified email is not used to merge or claim an existing account.

### Usernames

Usernames are lowercase and unique under a case-insensitive MongoDB index. Allowed characters are `a-z`, `0-9` and `_`; length is 3–24 characters. Reserved names are rejected. The profile endpoint is authenticated and derives ownership from the session.

### Conversation branches and versions

The legacy `messages` array remains as the `main` branch compatibility view. Branches store only their suffix after a fork point; the shared prefix is resolved from the parent branch. Message IDs are stable, and assistant messages can store multiple response versions. Editing a user message creates a new branch and regenerates from the edited prompt. Regeneration writes a new version without destroying the previous response. Revision checks return HTTP 409 when a stale client attempts to overwrite a newer conversation.

### Response sharing

Sharing creates a public read-only snapshot containing only the selected assistant response by default. Optional prompt context is supported by the API, but is not included by the default UI action. Snapshots omit reasoning, tool activity, credentials and unrelated chat metadata. Open **Settings → Shared links** to revoke a snapshot. Revocation makes the public share endpoint return 404. Set `FRONTEND_URL` to the public client origin so generated share links use the correct host.

### Browser persistence and streaming

The active chat ID is stored as a small local preference. The composer draft is stored in IndexedDB. A pending-generation marker is used to detect an interrupted stream after a refresh; it does not pretend that the server-side generation is still running. The user can navigate to another chat while a generation continues; stream updates remain associated with the originating chat. Auto-scroll follows the response only while the user remains near the bottom.

### API additions

- `GET/PATCH /api/account/profile` and `GET /api/account/profile/username-availability`
- `GET /api/auth/{google|github|discord}/link` (authenticated OAuth linking start)
- `POST /api/chats/:id/branches` and `PATCH /api/chats/:id/branches/:branchId/activate`
- `POST /api/chats/:id/messages/:messageId/versions` and `PATCH /api/chats/:id/messages/:messageId/version`
- `POST/GET /api/shares`, `DELETE /api/shares/:shareId`, and public `GET /api/public/shares/:shareId`

## Verification notes

The repository includes 19 Node.js unit tests covering conversation branches, interpreter input/queue limits, Vercel Sandbox provider behavior, idempotent persistent workspace creation, output caps, cancellation and persistent artifact ownership. Run `npm test`. A successful unit-test run does not replace a live MongoDB migration rehearsal, OAuth-provider testing, frontend production build, live Vercel Sandbox credential and microVM verification, or deployment-level browser testing.
