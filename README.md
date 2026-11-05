# Nemotron Agent Lab — MERN monorepo

A single-model, Agent Lab interface for NVIDIA Nemotron 3.5 Super VL. The frontend is a static React/Vite build; the Express backend owns model inference, OAuth, web search, plugin execution, personalization and memory. MongoDB persists user accounts, preferences, memories and chats.

## Stack and structure

```text
apps/
  client/     React 19 + Vite static frontend
  server/     Express API + Mongoose + OAuth + agent runtime
```

## Local setup

Requirements: Node.js 20+, npm 10+, MongoDB.

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
- All registered plugins are supplied to the model automatically; the UI shows their status in the composer drop-up and does not expose enable/disable controls.
- The Thinking control toggles `chat_template_kwargs.enable_thinking`. The model's `reasoning_content` is displayed in the message as a collapsible thinking trace.
- Temperature is fixed server-side to NVIDIA's recommended text value (1.0), or 0.6 for visual requests. No max-output-token cap is sent by default; the hosted deployment still enforces its own output/context limits.
- System prompt and initial instructions are backend-managed through `SYSTEM_PROMPT` and `INITIAL_INSTRUCTIONS`.
- Chat names are generated automatically after the first answer and can be regenerated from the header.
- Plugins include web search, public URL reading, GitHub search, npm search, calculator, date/time, save memory and search memories.
- Images and video are sent as images and sampled video frames, following the model's multimodal input format.

## Personalization and memory

The account menu includes Base style, Base tone, Warmth, Enthusiasm, Emoji usage, Visual answers, Headers and Lists. These preferences are stored per user and injected into the server-managed system prompt. Memory can be added, edited and deleted in the memory manager. The agent also has save/search memory tools; it should only save facts when the user explicitly asks it to remember them.

## Deployment

### One backend host serving the static frontend

```bash
npm run build
npm start
```

The root `prestart` script builds the React client; Express serves `apps/client/dist` when `SERVE_STATIC=true`.

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
