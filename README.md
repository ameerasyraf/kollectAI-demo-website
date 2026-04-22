# Kollect AI Demo Website

Self-contained demo portal for **Kollect AI VoiceBot** and **KollectGPT**.

This folder is intentionally portable. When ready, move `DEMO_WEBSITE` into its own repository and keep the same commands.

## Pages

- `/` - Landing page with product summaries and demo CTAs
- `/voicebot` - Browser demo shell for Kollect AI VoiceBot
- `/kollectgpt` - Browser chat demo for KollectGPT

## Why There Is A Backend

API keys should not live in browser code. The React app calls local endpoints under `/api/*`, and `server/index.js` forwards those requests to the real Kollect services using secrets from `.env`.

```text
Browser UI -> /api/kollectgpt/chat -> KollectGPT API
Browser UI -> /api/voicebot/*     -> VoiceBot API
```

If the API URLs/keys are empty, the demo uses mock responses so the website can still be reviewed.

## Setup

```bash
npm install
cp .env.example .env
npm run dev:full
```

On PowerShell:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev:full
```

Frontend: `http://localhost:5177`

Backend: `http://localhost:8787`

## Easy Start / Stop

On Windows PowerShell:

```powershell
npm.cmd run all:start
npm.cmd run all:stop
npm.cmd run all:restart
```

This starts the VoiceBot backend helper on `8010`, the demo API on `8787`, and the demo frontend on `5177`. If your existing VoiceBot backend is already running on `8000`, use the website-only commands below.

The VoiceBot helper now auto-detects a sibling `kollect-ai-voicebot` repo, or you can point it explicitly with `VOICEBOT_REPO_ROOT`.

Website-only commands:

```powershell
npm.cmd run demo:start
npm.cmd run demo:stop
npm.cmd run demo:restart
```

These commands run the demo frontend on `5177` and the demo API server on `8787` in the background. Logs are written to `DEMO_WEBSITE/logs/`.

## Environment Variables

```env
KOLLECTGPT_API_URL=http://192.168.2.12:3001
KOLLECTGPT_API_KEY=your_private_key
KOLLECTGPT_CHAT_PATH=/api/chat/stream
KOLLECTGPT_TIMEOUT_MS=180000

VOICEBOT_API_URL=https://your-voicebot-endpoint.example
VOICEBOT_API_KEY=your_private_key
VOICEBOT_AGENT_ID=
```

For the current browser chat + voice shell, you can use the public widget integration:

```env
VOICEBOT_INTEGRATION_MODE=public_widget
VOICEBOT_API_URL=http://localhost:8010/api/public/widget
VOICEBOT_WIDGET_FRAME_URL=http://localhost:8010/widget.html
VOICEBOT_WIDGET_KEY=your_publishable_widget_key
VOICEBOT_WIDGET_ENVIRONMENT=development
VOICEBOT_WIDGET_ORIGIN=http://localhost:5177
VOICEBOT_PAGE_URL=http://localhost:5177/voicebot
VOICEBOT_MODE_PREFERENCE=voice
```

`VOICEBOT_API_KEY` is only needed for the generic VoiceBot proxy path. The public widget flow uses `VOICEBOT_WIDGET_KEY` and expects `VOICEBOT_API_URL` to already include `/api/public/widget`.

The widget key is publishable, but the demo still keeps integration details in the server `.env` so the frontend remains easy to reconfigure.

For the separate demo-voice deployment flow, use:

```env
VOICEBOT_INTEGRATION_MODE=public_demo_voice
VOICEBOT_API_URL=http://192.168.2.12/api
VOICEBOT_DEMO_KEY=your_publishable_demo_key
VOICEBOT_DEMO_ENVIRONMENT=development
VOICEBOT_DEMO_ORIGIN=http://localhost:5177
```

This mode is voice-only. It bootstraps a short-lived demo token through `/api/public/demo-voice/bootstrap`, then uses that token for the WebRTC offer, candidate, and end-session calls.

## Production Build

```bash
npm run build
npm start
```

The Express server serves the compiled frontend from `dist` and exposes the same `/api/*` endpoints.

## Integration Notes

KollectGPT expected shape:

- Request from browser: `{ sessionId, messages }`
- Server forwards the latest user message to `/api/chat` as `{ message, session_id }`
- Server parses KollectGPT SSE events into: `{ reply, sessionId, raw? }`
- If `KOLLECTGPT_API_URL` is only the gateway origin, the demo defaults to `/api/chat`; use `KOLLECTGPT_CHAT_PATH` to override it.

For the demo website API access screen shown in KollectGPT, the typical setup is:

```env
KOLLECTGPT_API_URL=http://192.168.2.12:3001
KOLLECTGPT_CHAT_PATH=/api/chat/stream
KOLLECTGPT_API_KEY=your_generated_demo_website_bearer_token
```

The endpoint is reachable from this repo, but it returns `401` until a live demo website bearer token is generated and pasted into `.env`.

VoiceBot expected shape:

- `POST /api/voicebot/session` creates a public widget text session
- `POST /api/voicebot/message` sends typed fallback messages through `/public/widget/text/message`
- `POST /api/voicebot/webrtc/offer` opens a native WebRTC voice session for the demo UI
- `POST /api/voicebot/webrtc/candidate` forwards ICE candidates
- `POST /api/voicebot/end-session` ends the live voice session
- `GET /api/voicebot/config` returns public VoiceBot runtime configuration

The `/voicebot` page uses a custom React UI and talks to the VoiceBot backend through the demo server.
