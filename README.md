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

## Universal Python execution (v5 Monty upgrade)

The agent now exposes one general-purpose `execute_python` function tool. The model decides when to call it; users do not need to select a tool in the composer. Tool calls and their status/arguments/results appear inside the assistant response activity panel. Fenced code blocks include a language label and a copy action. The composer uses **Enter for a newline** and **Ctrl+Enter (Cmd+Enter on macOS) to send**.

### Python runtime (Pydantic Monty OSS WebAssembly)

The v5 interpreter uses the open-source `@pydantic/monty` package through its
`@pydantic/monty/wasm` entry point. Under Node.js, Monty WASM runs in
`node:worker_threads`; the application does not spawn Python, invoke Docker, or need
root access. A Node.js 20+ runtime with worker-thread support is required.

Install dependencies and verify the runtime:

```bash
npm install
npm run monty:check
```

Configure the optional resource settings in `.env`:

```env
MONTY_MAX_WORKERS=1
MONTY_MAX_MEMORY_BYTES=33554432
MONTY_MAX_FEED_SECONDS=12
```

The backend clamps these values to safe ranges. Defaults are one worker, 32 MiB of
Monty heap memory per session, and a 12-second maximum feed duration. Each session
also has recursion, host-suspension and cumulative sleep limits. With a one-worker
configuration, queued checkouts wait up to the feed limit plus a small margin. The
worker pool is created lazily when the first Python execution arrives.

**Monty is a Python subset, not full CPython.** Its bundled standard library covers
common tasks such as math, JSON, CSV, text processing, dates, regular expressions and
collections. Third-party packages such as NumPy, Pandas, Matplotlib, SciPy, Pillow and
openpyxl are not available. The WASM build does not support filesystem mounts. Python
code cannot use `open()` or `pathlib` to access host files and has no ambient network
or environment access.

To produce a downloadable file, the model must call the explicitly exposed
`create_artifact(name, content, mime_type)` host function. The backend validates the
name, MIME type, owner, size and artifact count before storing it. Artifacts are
available through the existing authenticated download endpoint for one hour. Storage
is capped at 20 MB per account and 64 MB per server process. Artifacts use temporary
host storage and are process-local: they do not survive restarts or move between replicas.
The other exposed host function, `check_cancelled()`, supports cooperative cancellation;
Monty also enforces the feed-duration limit. Cancellation is not an instant hard kill:
code that does not reach the cooperative check may continue until the execution limit.

The authenticated API contracts are preserved:

- `POST /api/interpreter/execute` with `{ "code": "print(1 + 1)", "executionId": "optional-client-id" }`
- `POST /api/interpreter/cancel/:id` requests cancellation.
- `GET /api/interpreter/artifacts/:id` downloads an owner-checked artifact.
- `GET /api/interpreter/status` reports the active interpreter provider and readiness.

Execution requires a signed-in account. The existing model-facing `execute_python`
tool is unchanged at the API/schema level. The provider is reported as
`pydantic-monty-wasm` in execution results.

**Isolation note:** Monty evaluates Python in a constrained WebAssembly runtime and
only the narrow host functions above are exposed. The Node WASM build uses worker
threads, not separate OS processes or containers. Do not add broad host functions or
pass secrets, unrestricted filesystem handles, or network clients into the sandbox.
For deployments accepting hostile multi-tenant code, retain OS-level resource controls
and conduct a security review of the actual hosting environment.

### Current upgrade scope

This repository update includes the isolated Python execution foundation, the model tool registration and streaming activity, owner-checked artifact downloads, removal of the composer plugin drop-up, multiline keyboard behavior, richer activity details, code-block copy controls, context-based chat title input, centralized versioned system-prompt construction, memory duplicate avoidance, and private-app SEO/robots metadata.

The continuity upgrade adds linked OAuth identities, editable profiles/usernames, conversation branches, response versions, prompt editing as a new branch, response regeneration, opt-in public snapshots with revocation, IndexedDB composer drafts, active-chat restoration, revision checks, context-aware/manual chat naming, and memory synchronization. The account migration is intentionally explicit and must be run before relying on the new linked-account/username fields. A production-grade end-to-end security audit, full attachment ingestion into Python, browser/device QA, and Monty WASM runtime compatibility and worker-thread behavior must still be verified on the target managed host. Do not treat those items as completed.


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

The repository includes 17 Node.js unit tests covering conversation branches, interpreter input/queue limits, Monty provider behavior, output caps, cancellation and artifact ownership. Run `npm test`. A successful unit-test run does not replace a live MongoDB migration rehearsal, OAuth-provider testing, frontend production build, managed-host Monty WASM verification, or deployment-level browser testing.
