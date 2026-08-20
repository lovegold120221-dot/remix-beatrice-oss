This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/263c384d-d6b5-437a-87ea-dfc57d324df5

## Real Skills & Capabilities

Every capability below is a real, working tool registered in the server's function declarations (`server.ts`) — nothing simulated. Beatrice is a real-time voice assistant that executes these only when the user explicitly asks.

### Chat & Knowledge
- **Real-time voice conversation** — Gemini Live (`gemini-3.1-flash-live-preview`), 120+ languages, voice + video + screen share
- **webSearch** — live web search (Google grounding through Gemini)
- **getWeather** — current conditions & forecast for any location
- **getSystemInfo** — server Node version, memory, uptime, process metrics

### WhatsApp (18 tools, via Baileys pairing)
- **Sending** — text, quoted replies, group messages, contact cards (vCard), documents (server file or base64)
- **Reading** — chats, message history per chat, contacts, groups, call records; full history sync
- **Media** — attachment download (`read_whatsapp_attachment`), voice-note transcription via Gemini (`transcribe_whatsapp_audio`)
- **Management** — block/unblock contacts, resolve recipients by name/number/JID, send-approval flow (`request_whatsapp_send`, auto-approve by default)
- **Calls** — `whatsapp_call` (note: WhatsApp-Web protocol cannot actually place calls; the tool reports that honestly)

### Google Workspace (33 tools, OAuth via Firebase)
- **Gmail** — list/search, read full message, send, drafts, modify labels, trash, delete
- **Calendar** — list, create/update/delete events, attach Google Meet links; **Meet** — create conferences
- **Drive** — list/search/get/create/update content/delete files; **Docs/Sheets/Slides** — create from scratch; **Forms** — create & list
- **Tasks** — list/create/update (incl. complete)/delete; **Contacts** — CRUD; **YouTube** — search

### Code & Computing
- **executeCodeSandbox** — isolated execution of JavaScript / TypeScript / Python / HTML (streams output to the workspace)
- **runCliCommand** — real shell commands on the server (node, git, python3, ffmpeg, curl, npm …)
- **deployAgentTask** — spawn sub-agents (code reviewer, research agent, data analyst…) for complex reasoning
- **runCodingAgent** — spawns the real OpenCode CLI (default `/root/.opencode/bin/opencode`) to autonomously write/edit/debug multi-file projects; default model is the Zen free model `opencode/deepseek-v4-flash-free` (see `~/.config/opencode/opencode.jsonc`)
- **runBrowserAutomation** — real headless Chrome via Playwright: navigate, click, type, scroll, extract live data
- **runComputerControl** — desktop control of the server machine (shell, apps, mouse, keys)

### Creative Media (paid APIs already configured — used only on explicit request)
- **Images** — `qwenImageGenerate` / `qwenImageEdit` (QwenCloud Wan 2.7, up to 4K, watermark option)
- **Video** — `qwenVideoGenerate` (happyhorse-1.1-t2v, 720P/1080P, 2–15s, optional lip-sync audio) and `generateVideo` (DashScope happyhorse-1.1-t2v clips)
- **Speech** — `qwenTts` (qwen3-tts-flash, multiple voices/languages)
- **Chat** — `qwenChat` (QwenCloud qwen3.8-max / 3.7-plus / 3.7-flash)

### Presentation
- **updateCanvasVisual** — live canvas cards: Mermaid diagrams, markdown documents/reports, data charts, code snippets

### Delegated skill library (via runCodingAgent → OpenCode CLI)
The coding agent carries 89 skills on the server (`~/.agents/skills/`):
- **Working now** (no extra keys): ffmpeg media editing, code in any framework (React, Three.js, GSAP, D3, Manim), browser automation, data visualization, file processing
- **Works after install** (needs internet): yt-dlp downloads, Whisper transcription, Remotion / HyperFrames local renders
- **Needs a missing API key** (Beatrice says so honestly, never fakes it): HeyGen, ElevenLabs, fal.ai, Runway, Kling, Seedance, Grok, BFL FLUX, Doubao TTS, Azure STT, Lyria, ACE-Step, LTX-2 — add the key to `.env.local` and restart

Other services: internal WS tool services on ports 5556–5560 (sandbox, CLI, browser, computer, coding agent), REST `/api/tools/*`, `/api/workspace/*`, `/api/whatsapp/*`, WS `/live`.

## Documentation

- **[install-server.sh](install-server.sh)** — full server provisioning: system toolchain, Playwright Chromium, OpenCode CLI, `.env.local`, data dirs, npm install + build; `--skip-deps` for code-only re-install, `INSTALL_SYSTEMD=1` for a systemd unit
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — full production deployment guide: install script walkthrough (step-by-step table), sandbox & service integration notes, env vars, build/run, Caddy & Nginx + Let's Encrypt, WebSocket header forwarding, verification checklist, operational notes
- **[APP_LOGIC.md](APP_LOGIC.md)** — runtime app logic with Mermaid diagrams: live voice flow, tool dispatch, WhatsApp SOP, coding agent, resilience, message contract, REST endpoints

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Production (oss.eburon.ai + Let's Encrypt)

Run on your server:
```bash
npm install
npm run build
PORT=5555 APP_URL=https://oss.eburon.ai node dist/server.cjs
```

**Easiest HTTPS:** Use Caddy (see `Caddyfile`)
```bash
# Install caddy, then
caddy run --config Caddyfile
```

It will automatically get a Let's Encrypt certificate for oss.eburon.ai and proxy to port 5555.
