# Project Knowledge

## What this is

**Beatrice OSS** — a single-package (no monorepo) web app: React 19 SPA + Express server with a Gemini Live (WebSocket) voice/text AI assistant. It bundles tool services for sandboxed code execution, CLI commands, browser automation, computer control, a coding agent (spawns OpenCode CLI), Google Workspace (Gmail/Calendar/Drive/etc.), WhatsApp via Baileys (with auto-reply "Boss Mode"), and QwenCloud media generation (images/video/TTS). Realtime via WS `/live`; REST under `/api/*`.

## Key code locations

- `server.ts` (root) — full server: Express routes, WS `/live`, Gemini Live session (`gemini-3.1-flash-live-preview`), Vite middleware in dev. The Live loop executes **one function call per turn** (extra calls are skipped).
- `src/main.tsx` — React 19 entry (`<AuthProvider><App /></AuthProvider>`).
- `server/toolRegistry.ts` — central tool registry: `registerTool` + `registerAllTools()` at boot, `dispatchTool` for WS calls. Boot-time `validateToolCoverage()` throws on drift between declarations ↔ catalog ↔ registry.
- `server/toolDeclarations.ts` — Gemini tool schemas/descriptions (`getFunctionDeclarations()`). Memory handlers are registered in toolRegistry.
- `server/toolCatalog.ts` + `server/skills/` — single source of truth for tool metadata (domain, risk, skillRoutes) and skill route definitions.
- Skill routing pipeline: `server/queryRouter.ts` (text → intent) → `server/skillRouter.ts` (intent + ActiveContext → SkillRoute) → `server/skillExecutor.ts` (runs skill steps, emits `skillExecutionUpdate`) → `dispatchTool`. Entry: `server/toolRoutingMiddleware.ts` (`handleFunctionCallWithSkills`) — every call is ALLOW/REROUTE/CLARIFY/BLOCK.
- `server/tools.ts` — tool implementations (sandbox, CLI, coding agent, media gen, web search, browser/computer control, QwenCloud).
- `server/googleWorkspace.ts` — Gmail/Calendar/Drive/Forms/Tasks/Contacts/Meet/YouTube handlers. Auto-renews expired access tokens via `server/googleOAuth.ts` (server-side OAuth2 with per-user refresh tokens stored in `google_tokens/{uid}`; flow initiated from the Profile modal → `POST /api/google/connect` → `GET /api/google/callback`).
- `server/whatsapp-tools.ts` — Baileys WhatsApp, per-user sessions (uid from Firebase token), Boss Mode auto-reply, knowledge base.
- `server/taskStore.ts` — per-user generation task history (`/api/tasks`, RTDB-persisted with in-memory fallback).
- `server/auth.ts` — Firebase ID-token verification with `jose` (JWKS + RS256); `requireAuth` middleware. Auth ON by default; `AUTH_DISABLED=1` turns it off.
- `server/isolate.ts` — sandboxed code execution via `timeout → unshare → setpriv → prlimit` (no Docker on host).
- `server/logger.ts` (pino) + `server/metrics.ts` (Prometheus, exposed at `/metrics`).
- `server/memoryFallback.ts` — local JSON fallback for the 3 memory tools when the external MemoryCore gateway (127.0.0.1:8420) is down.
- `server/toolProxy.ts` + `server/services/` — standalone WS services on ports 5556-5560 (sandbox, cli, browser, computer, codingAgent).
- `src/context/AuthContext.tsx` — Firebase auth + Google OAuth token persistence. The Google access token is stored in RTDB `google_tokens/{uid}` on every grant/renewal (with a 30-min keep-fresh timer so it never expires mid-session) and the server's workspace tools read it back from there (`server/googleWorkspace.ts`). `connectGoogleServer()` runs the server-side OAuth popup flow to obtain a refresh token.

## Commands

- `npm install` — install deps (npm is canonical; `bun.lock` also exists but is stale).
- `npm run dev` — `tsx server.ts` (Express + Vite middleware + WS).
- `npm run build` — `vite build && esbuild server.ts` → `dist/server.cjs`.
- `npm start` — `node dist/server.cjs` (real server; `npm run preview` is static-only).
- `npm run lint` / `npm run typecheck` — both `tsc --noEmit` (**run to verify**).
- `npm test` — `WHATSAPP_AUTO_INIT=0 tsx --test test/*.test.ts` (node:test, 14 files). The env guard is required so Baileys/RTDB auto-init timers don't hang the runner — keep it.
- `npm run clean` — `rm -rf dist server.js`.
- `sudo bash install-server.sh` — full server provisioning; `--skip-deps` for code-only re-install.
- `node make_prompt.cjs` — regenerate `system_prompt.md` from the source template (use `.cjs`, not `.js`).
- CI (`.github/workflows/ci.yml`) runs `npm ci && npm run typecheck && npm test`.

## Environment (`.env.local` overrides `.env`)

- `GEMINI_API_KEY` — required at runtime (real key, not a placeholder). Live API + some tools.
- `DASHSCOPE_API_KEY` — required for `qwen*`, `generateVideo`, DashScope tools; not in `.env.example`. Two hosts: intl endpoint (`DASHSCOPE_INTL_BASE`) + Token Plan (`DASHSCOPE_BASE` / `DASHSCOPE_LEGACY_API_KEY`).
- `TDAI_LLM_API_KEY` / `TDAI_LLM_SERVICE_ID` — auth for the external MemoryCore gateway (memory add/search/core-read at `http://127.0.0.1:8420/v2/...`). Defaults `beatrice-llm-proxy` / `beatrice-memory`; if the service is down the memory tools fall back to `server/memoryFallback.ts` (`data/memory-fallback.json`).
- `AUTH_DISABLED=1` — off by default: every `/api/*` route (except `/health`, `/terminal/info`, `/sandbox/preview/*`) requires a Bearer token; WS upgrades need `?token=`.
- `DISABLE_HMR=true` — disables Vite HMR/watch (AI Studio default).
- `PORT` (default 5555), `APP_URL`, `NODE_ENV=production` (serves `dist/`).
- `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_RTDB_URL` — RTDB persistence; the default `/opt/beatrice-services/...` key is revoked — `.env.local` points to `data/beatrice-os-owner-service-account.json` (do not delete).
- `WHATSAPP_SEND_AUTO_APPROVE`, `WHATSAPP_AUTH_DIR` (default `data/whatsapp-auth`).
- `SANDBOX_*` / `TERMINAL_ROOT` / `LOG_LEVEL` / `WHATSAPP_AUTO_INIT` — sandbox constraints, terminal cwd, log level, WhatsApp auto-init guard.

## Conventions & gotchas

- **ESM** (`"type": "module"`); from `server.ts` only, relative imports to `./server/*.ts` must use `.js` extension.
- `@/*` alias → project root.
- Hardcoded Live model: `gemini-3.1-flash-live-preview`; default voice `Aoede`.
- **Baileys v7 needs `globalThis.crypto.subtle`** — `server/whatsapp-tools.ts` polyfills `globalThis.crypto = webcrypto` at module top; don't remove (Node 18 CJS entrypoints don't expose it).
- WhatsApp lifecycle: `connectSocket()` must `await sock.waitForSocketOpen()` before `requestPairingCode()`; set `sock = null` on unexpected close or reconnects block forever.
- RTDB persistence: message keys must be JID-encoded via `encodeRTDBKey` (RTDB forbids `.` `#` `/` `[` `]`); `undefined` fields must be `null`-sanitized.
- Media-generation tools (`qwenImageGenerate`, `qwenVideoGenerate`, `generateVideo`, TTS) may **only** run when the user **explicitly** asks, and require a mandatory pre-flight spec confirmation (aspect ratio, size, duration, style, restated + agreed) — see `MEDIA_GENERATION.md`. Tool declarations restate this: call only after the user confirms the complete final spec.
- **One generation task at a time**: `server/taskGate.ts` holds a per-user single slot for image gen/edit, video gen (`generateVideo`/`qwenVideoGenerate`), TTS, `runCodingAgent`, and `deployAgentTask`. A trigger while one is in flight is **rejected** with a busy message (no model call, no second task card) — the next task only starts after the current one finishes. Video still renders via the background per-user FIFO queue; the gate keeps its slot from enqueue until the render completes (and for coding agents until the service reports a terminal `codingAgentUpdate`).
- When adding a tool: catalog entry → skill step/`skillRoutes` → Gemini declaration → `registerTool` call (boot-time validators catch drift).
- No ESLint/Prettier; `tsc --noEmit` is the verification step. Tests exist (see Commands).
- Production: systemd unit `beatrice-oss.service` at `/root/remix-beatrice-oss`, `/usr/bin/node dist/server.cjs` on 5555 behind Caddy (Let's Encrypt). Don't touch other `beatrice-*.service` units (separate project).
- `task-page.html` is a standalone demo page — not wired into the SPA.
- `data/` (gitignored) holds WhatsApp auth state, sandbox previews, coding-agent logs.
- Internal docs beat README when they differ: `FLOW.md` (freshest), `APP_LOGIC.md`, `DEPLOYMENT.md`, `MEDIA_GENERATION.md`.
