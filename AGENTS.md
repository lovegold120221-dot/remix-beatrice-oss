# AGENTS.md

## Commands
- `npm install`
- `sudo bash install-server.sh` — full server provisioning (apt build tools/ffmpeg/libxtst-dev/libpng-dev, Playwright Chromium, OpenCode CLI, `.env.local` from `.env.example`, data dirs, npm install, build). `--skip-deps` for code-only re-install; `INSTALL_SYSTEMD=1` adds a systemd unit. Do NOT run two app instances per host (service ports 5556-5560 clash).
- `npm run dev` — runs `tsx server.ts` (Express + Vite middleware + WS)
- `npm run build` — `vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`
- `npm start` — `node dist/server.cjs`
- `npm run lint` — `tsc --noEmit` (typecheck; only "lint" step)
- `npm run clean` — `rm -rf dist server.js` (note: `server.js` target is stale)
- `node make_prompt.cjs` — regenerate `system_prompt.md` from the source template literal inside the script. Note: `.js` would fail because package.json is `"type": "module"`; the canonical file is the `.cjs` variant.

Always run `npm run lint` for verification. No test script or tests exist.

## Environment
- `GEMINI_API_KEY` (must be real key, not `MY_GEMINI_API_KEY`) — checked at runtime in server.ts; required for Live API and some tools.
- `DASHSCOPE_API_KEY` — required for all `qwen*` (QwenCloud), `generateVideo`, and DashScope-based tools (checked in server/tools.ts); not in `.env.example`, add it to `.env.local`.
- dotenv loads `.env` then `.env.local` (override) early in server.ts. Use `.env.local` for local `GEMINI_API_KEY` (gitignored).
- `PORT` (default 5555) and `APP_URL` (e.g. http://168.231.78.113:5555 or https://oss.eburon.ai) are read from env for server binding and public references.
- `DISABLE_HMR=true` — disables Vite HMR and watch (AI Studio default to avoid flicker on edits).
- `NODE_ENV=production` switches server to serve `dist/` static + SPA fallback.
- `WHATSAPP_SEND_AUTO_APPROVE` (default `true`) — set to `false` to require human approval for outgoing WhatsApp messages.
- `WHATSAPP_AUTH_DIR` (default `data/whatsapp-auth`) — Baileys auth state directory.

## Architecture & Wiring
- Single package (no monorepo workspaces).
- `server.ts` (root) — full server: Express routes, WS `/live`, Gemini Live session (`gemini-3.1-flash-live-preview`), Vite middleware in dev.
- `src/main.tsx` — React 19 entry (`<AuthProvider><App /></AuthProvider>`).
- `server/tools.ts` — executeCodeSandbox, runCliCommand, deployAgentTask, runCodingAgent (spawns OpenCode CLI), updateCanvasVisual, getWeather, webSearch, getSystemInfo, QwenCloud (chat/image/video/TTS), video generation (fallback chain: happyhorse-1.1-t2v → wan3.0-video → wan2.7-t2v → wan2.6-t2v), browser automation, computer control.
- `server/googleWorkspace.ts` — all Gmail/Calendar/Drive/Forms/Tasks/Contacts/Meet/YouTube handlers.
- `server/whatsapp-tools.ts` — WhatsApp integration via Baileys (pairing, messaging, contacts, groups, calls, media).
- `server/toolProxy.ts` — WebSocket proxy to internal services on ports 5556-5560.
- `server/services/` — standalone WS services started on server boot: sandboxService (5556), cliService (5557), browserService (5558), computerService (5559), codingAgentService (5560). codingAgentService spawns the OpenCode CLI (`OPENCODE_BIN`, default `/root/.opencode/bin/opencode`) to autonomously edit code; logs to `data/coding-agent-logs/`. Ports overridable via `SANDBOX_SERVICE_PORT`/`CLI_SERVICE_PORT`/`BROWSER_SERVICE_PORT`/`COMPUTER_SERVICE_PORT`/`CODING_AGENT_PORT` env vars. The spawned CLI's default model comes from the global config `~/.config/opencode/opencode.jsonc` (currently `opencode/deepseek-v4-flash-free`, a Zen free model; `opencode` provider already authenticated in `~/.local/share/opencode/auth.json`).
- Client Firebase init in `src/lib/firebase.ts` (imports `../../firebase-applet-config.json` which includes `oAuthClientId`).
- Google OAuth web credentials are in `google-web-credentials.json` (gitignored) + `GOOGLE_*` vars in `.env.local`. Used for workspace auth (currently client-side via Firebase).
- REST: `/api/health`, `/api/tools/*`, `/api/workspace/*`, `/api/whatsapp/*`.
- Realtime: WS messages for audio/video/text/attachments/tool calls; broadcasts transcripts/status/toolResults/sandboxOutput/cliOutput/browserUpdate/computerUpdate/agentUpdate/codingAgentUpdate/canvasUpdate/videoGenerationUpdate/qwencloudUpdate/whatsappStatus.

## Module / Toolchain Quirks
- ESM (`"type": "module"`). From `server.ts` only: relative imports to `./server/*.ts` files must use `.js` extension (e.g. `./server/tools.js`).
- `@/*` alias → project root (tsconfig + vite.config).
- tsx for direct TS execution in dev; esbuild for server bundle (cjs output).
- Vite serves SPA; index.html at root points to `/src/main.tsx`.
- make_prompt.cjs embeds full voice personality + lore; `system_prompt.md` is the generated runtime copy loaded by server.ts on WS connect. `knowledge_base.md` is also loaded and appended as a compact global KB.
- Hardcoded model: `gemini-3.1-flash-live-preview` in server.ts. Default voice: `Aoede` (not Zephyr).
- package.json "name": "react-example" (stale).
- Both `package-lock.json` and `bun.lock` exist; npm is the canonical package manager per AGENTS.md commands.

## Other Notes
- No ESLint, Prettier, tests, CI, or task runner.
- Firebase applet config, firestore.rules, firebase-blueprint.json present (auth scopes include Drive/Gmail/Forms etc.).
- Google OAuth web credentials (`google-web-credentials.json`) + env vars for the new client.
- `data/` directory (gitignored) stores WhatsApp auth state + media, sandbox previews, and coding-agent logs.
- For local outside AI Studio: camera/mic + valid GEMINI_API_KEY needed for core features; Google OAuth for workspace tools; WhatsApp requires phone pairing via Baileys.

## Production (Let's Encrypt + domain)
- Build with `npm run build`, then run `node dist/server.cjs` on port 5555 (plain HTTP).
- The live deployment uses systemd service `/etc/systemd/system/beatrice-oss.service`:
  - WorkingDirectory: `/root/remix-beatrice-oss`
  - EnvironmentFile: `/root/remix-beatrice-oss/.env.local`
  - ExecStart: `/usr/bin/node dist/server.cjs`
  - Restart: always
  - Run `systemctl daemon-reload && systemctl restart beatrice-oss.service` after deploy.
- Use reverse proxy for HTTPS:
  - **Recommended (easiest):** Caddy (see Caddyfile) — auto Let's Encrypt.
  - Alternative: Nginx + certbot (see nginx-oss.conf).
- Set `APP_URL=https://oss.eburon.ai` and `PORT=5555`.
- Proxy must forward `X-Forwarded-Proto` and `Upgrade`/`Connection` headers for WebSocket.

## Internal Docs (prefer over README)
- `APP_LOGIC.md` — runtime topology traced from server.ts/tools.ts (client ↔ WS ↔ tool services).
- `DEPLOYMENT.md` — full deployment guide, env var table, prerequisites.
- `MEDIA_GENERATION.md` — non-negotiable rule: media-generation tools (`qwenImageGenerate`, `qwenVideoGenerate`, `generateVideo`, TTS) may only run when the user **explicitly** asks; ambiguous requests must be declined with a clarifying question. When editing tool descriptions in server.ts, keep them consistent with this doc's decision tree.

See `server.ts` (and its imports) and `vite.config.ts` for execution flow. Prefer these over README when they differ.
