# Nemotron Client — React Frontend

A full-stack Agent Lab interface for NVIDIA Nemotron 3.5 Super VL, built with React, Vite, and MongoDB.

## Features

- Workspace color themes (Forest, Midnight, Ocean, Amethyst, Nord, Solarized) with a theme picker in Personalization, persisted across sessions.
- Personalization and persistent memory with editable long-term memory.
- Autonomous task planning with up to 12 steps, dependency validation, and explicit task-state transitions.
- Live progress updates, thinking trace, and bounded self-correction for tool failures.
- Cloudflare Workers AI image generation (FLUX.1 Schnell) with binary validation and File Library storage.
- OAuth authentication (Google, GitHub, Discord) with secure HttpOnly cookies.
- Web search via Tavily API.

## Stack

- **Frontend**: React 19 + Vite static build
- **Build tool**: Vite
- **Dependencies**: react, react-dom, react-markdown, remark-gfm, lucide-react

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- npm 10+

## Installation

1. Install dependencies: `npm install`
2. Copy the example environment file: `cp .env.example .env`
3. Fill in required environment variables (see below)
4. Run the development server: `npm run dev`

## Development

- Frontend: `http://localhost:5173`
- Run: `npm run dev`

## Build for Production

```bash
npm run build
npm start
```

Set `SERVE_STATIC=true` in the backend environment to serve the static frontend files.

## Configuration Details

- Register OAuth callback URLs in Google, GitHub, and Discord developer consoles:
  - Google: `http://localhost:4000/api/auth/google/callback`
  - GitHub: `http://localhost:4000/api/auth/github/callback`
  - Discord: `http://localhost:4000/api/auth/discord/callback`
- In production, use HTTPS and appropriate domain URLs for all callbacks.

## Security

- API keys are backend-only; never expose them in client-side code.
- Use HTTPS and `Secure`/`SameSite=None` cookies in production.
- Apply monitoring, backups, and stricter per-user quotas before public deployment.
