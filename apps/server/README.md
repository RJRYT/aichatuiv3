# Nemotron Server — Express Backend

A full-stack Agent Lab interface for NVIDIA Nemotron 3.5 Super VL, built with Express, Mongoose, and MongoDB.

## Features

- RESTful API built with Express for managing users, authentication, chats, and agent interactions.
- OAuth authentication (Google, GitHub, Discord) with secure HttpOnly cookies.
- MongoDB persistence for accounts, preferences, memories, chats, and agent state.
- Cloudflare Workers AI image generation integration (FLUX.1 Schnell) with binary validation.
- Tavily API web search integration.
- Agent runtime and planning services.
- Secure session management with `SESSION_SECRET`.
- Rate limiting and security headers via Helmet.

## Stack

- **Framework**: Express 4.x
- **Database**: MongoDB (via Mongoose)
- **Auth**: OAuth (Google, GitHub, Discord) with HttpOnly cookies
- **AI**: Cloudflare Workers AI (FLUX.1 Schnell)
- **Search**: Tavily API
- **Environment**: Node.js >=20.19.0

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- npm 10+
- MongoDB instance
- (Optional) Cloudflare Workers AI account for image generation
- (Optional) Tavily API key for web search

## Installation

1. Install dependencies: `npm install`
2. Copy the example environment file: `cp .env.example .env`
3. Fill in required environment variables (see below)
4. Run the development server: `npm run dev`

## Development

- Backend: `http://localhost:4000`
- Run: `npm run dev`

## Build for Production

```bash
npm run build
npm start
```

Set `SERVE_STATIC=true` in the backend environment to serve the static frontend files.

## Configuration Details

| Variable                       | Description                                                     |
| ------------------------------ | --------------------------------------------------------------- |
| `NVIDIA_API_KEY`               | Your NVIDIA API key (backend‑only)                              |
| `MONGODB_URI`                  | MongoDB connection string                                       |
| `SESSION_SECRET`               | Long, high‑entropy secret for session signing                   |
| `TAVILY_API_KEY`               | Tavily API key (for web search)                                 |
| `CLOUDFLARE_ACCOUNT_ID`        | Cloudflare account ID (Workers AI)                              |
| `CLOUDFLARE_API_TOKEN`         | Workers AI API token                                            |
| `CLOUDFLARE_IMAGE_MODEL`       | Model identifier (e.g., `@cf/black-forest-labs/flux-1-schnell`) |
| `CLOUDFLARE_IMAGE_TIMEOUT_MS`  | Timeout in milliseconds (default 120000)                        |
| `IMAGE_GENERATION_DAILY_LIMIT` | Daily image generation quota (default 8)                        |

- Register OAuth callback URLs in Google, GitHub, and Discord developer consoles:
  - Google: `http://localhost:4000/api/auth/google/callback`
  - GitHub: `http://localhost:4000/api/auth/github/callback`
  - Discord: `http://localhost:4000/api/auth/discord/callback`
- In production, use HTTPS and appropriate domain URLs for all callbacks.

## Security

- API keys are backend‑only; never expose them in client‑side code.
- Use HTTPS and `Secure`/`SameSite=None` cookies in production.
- MongoDB is required for persistent storage of accounts, preferences, memories, and chats.
- Apply monitoring, backups, and stricter per‑user quotas before public deployment.
