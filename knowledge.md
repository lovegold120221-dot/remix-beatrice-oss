# Project Knowledge

## What this is

**Beatrice OSS** — a single-package (no monorepo) web app: React 19 SPA + Express server with a Gemini Live (WebSocket) voice/text AI assistant. It bundles tool services for sandboxed code execution, CLI commands, browser automation, computer control, a coding agent (spawns OpenCode CLI), Google Workspace (Gmail/Calendar/Drive/etc.), and WhatsApp messaging via Baileys (with auto-reply "Boss Mode"). Realtime via WS; REST under `/api/*`.

## Key code locations

- `server.ts` (root) — full server: Express routes, WS `/live`, Gemini Live session, Vite middleware in dev. Entry point for everything server-side.
- `src/main.tsx` — React 19 entry (`<AuthProvider><App /></AuthProvider>`).
- `server/tools.ts` — tool implementations (sandbox, CLI, coding agent, video/image gen, web search, browser/computer control, QwenCloud).
- `server/googleWorkspace.ts` — Gmail/Calendar/Drive/Forms/Tasks/Contacts/Meet/YouTube handlers.
- `server/whatsapp-tools.ts` — Baileys WhatsApp integration, Boss Mode auto-reply, knowledge base.
- `server.ts` also registers 3 memory tools (`remember_memory`, `recall_memory`, `get_core_memory`) that talk to the local MemoryCore gateway at `127.0.0.1:8420` (see env vars below) — long-term conversation memory for the assistant.
- `server/toolProxy.ts` — WS proxy to internal services on ports 5556-5560.
- `server/services/` — standalone WS services started on server boot (sandbox 5556, cli 5557, browser 5558, computer 5559, codingAgent 5560). Ports overridable via `*_PORT` env vars.
- `src/context/AuthContext.tsx` — Firebase auth + Google OAuth token persistence.

## Commands

- `npm install` — install deps (npm is canonical; `bun.lock` also exists but is stale).
- `npm run dev` — `tsx server.ts` (Express + Vite middleware + WS).
- `npm run build` — `vite build && esbuild server.ts` → `dist/server.cjs`.
- `npm start` — `node dist/server.cjs` (real server; `npm run preview` is static-only).
- `npm run lint` — `tsc --noEmit` (only "lint" step; **run this to verify**).
- `npm run clean` — `rm -rf dist server.js`.
- `sudo bash install-server.sh` — full server provisioning; `--skip-deps` for code-only re-install.
- `node make_prompt.cjs` — regenerate `system_prompt.md` from the source template.

No test script or tests exist.

## Environment (`.env.local` overrides `.env`)

- `GEMINI_API_KEY` — required at runtime (real key, not a placeholder). Live API + some tools.
- `DASHSCOPE_API_KEY` — required for `qwen*`, `generateVideo`, DashScope tools. Not in `.env.example`.
- `TDAI_LLM_API_KEY` / `TDAI_LLM_SERVICE_ID` — auth for the MemoryCore gateway (`server.ts`): memory add/search tools and core read call `http://127.0.0.1:8420/v2/{conversation/add,conversation/search,core/read}` with `Authorization: Bearer <key>` + `x-tdai-service-id` header. Defaults: `beatrice-llm-proxy` / `beatrice-memory`.
- `DISABLE_HMR=true` — disables Vite HMR/watch (AI Studio default to avoid flicker on edits).
- `PORT` (default 5555), `APP_URL`, `NODE_ENV=production` (serves `dist/`).
- `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_RTDB_URL` — RTDB persistence for the WhatsApp store; the default `/opt/beatrice-services/...` key is revoked — `.env.local` points to `data/beatrice-os-owner-service-account.json` (do not delete).
- `WHATSAPP_SEND_AUTO_APPROVE`, `WHATSAPP_AUTH_DIR` (default `data/whatsapp-auth`).

## Conventions & gotchas

- **ESM** (`"type": "module"`); from `server.ts` only, relative imports to `./server/*.ts` must use `.js` extension.
- `@/*` alias → project root.
- Hardcoded Live model: `gemini-3.1-flash-live-preview`; default voice `Aoede`.
- **Baileys v7 needs `globalThis.crypto.subtle`** — `server/whatsapp-tools.ts` polyfills `globalThis.crypto = webcrypto` at module top; don't remove (Node 18 CJS entrypoints don't expose it).
- RTDB persistence: message keys must be JID-encoded via `encodeRTDBKey` (RTDB forbids `.` `#` `/` `[` `]`); `undefined` fields must be `null`-sanitized.
- Media-generation tools (`qwenImageGenerate`, `qwenVideoGenerate`, `generateVideo`, TTS) may **only** run when the user explicitly asks — see `MEDIA_GENERATION.md`.
- No ESLint/Prettier/tests/CI. `tsc --noEmit` is the verification step.
- Production: systemd unit `beatrice-oss.service` at `/root/remix-beatrice-oss`, run with `/usr/bin/node dist/server.cjs` on 5555 behind Caddy (Let's Encrypt). Don't touch other `beatrice-*.service` units (separate project).
- `task-page.html` is a standalone demo page — not wired into the SPA.
- `data/` (gitignored) holds WhatsApp auth state, sandbox previews, coding-agent logs.
- Internal docs beat README when they differ: `APP_LOGIC.md`, `DEPLOYMENT.md`, `MEDIA_GENERATION.md`.
