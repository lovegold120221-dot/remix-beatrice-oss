# Repository Report — Beatrice OSS (remix-beatrice-oss)

Generated: 2026-08-12 · Branch: `main` · HEAD: `d1ae5f4`

---

## 1. Overview

**Beatrice OSS** is a production voice-assistant web application ("Beatrice" of Eburon AI) built as a single Node package. It pairs a React 19 SPA with an Express server that maintains a persistent **Gemini Live API** session (`gemini-3.1-flash-live-preview`) over a WebSocket, and exposes ~67 function-calling tools: code sandbox, CLI, sub-agents, a real OpenCode CLI coding agent, headless browser automation, desktop computer control, Google Workspace tools, WhatsApp (Baileys), QwenCloud/DashScope media generation, and canvas visual updates.

| Attribute | Value |
|---|---|
| Package name | `react-example` (stale) |
| Module system | ESM (`"type": "module"`); server bundled to CJS via esbuild |
| Frontend | React 19, Vite 6, Tailwind CSS v4, lucide-react, motion |
| Backend | Express 4 + `ws` (WebSocket), tsx (dev), esbuild (build) |
| AI | `@google/genai` (Gemini Live), QwenCloud/DashScope REST |
| WhatsApp | `@whiskeysockets/baileys` (rc14) |
| Firebase | web SDK + admin SDK (RTDB auth/config, storage uploads) |
| Ports | App 5555; tool services 5556–5560 (loopback only) |
| Lint | `tsc --noEmit` (no ESLint/Prettier/tests/CI) |
| Lockfiles | `package-lock.json` (canonical) + stale `bun.lock` |

**Runtime topology:** Browser ⇄ WS `/live` ⇄ server.ts ⇄ Gemini Live API, with tool dispatch to internal WS services (sandbox :5556, CLI :5557, browser :5558, computer :5559, coding agent :5560) via `server/toolProxy.ts` / `forwardToService`, plus REST `/api/*` endpoints. See `APP_LOGIC.md` for Mermaid diagrams.

---

## 2. File inventory

### Documentation & config (root)
| File | Notes |
|---|---|
| `README.md` | Feature/capability marketing doc; claims all tools are "real, working — nothing simulated" (contradicted — see §6) |
| `APP_LOGIC.md` | Accurate runtime topology + message contract (traced from code) |
| `DEPLOYMENT.md` | Solid deployment guide; env table; Caddy/Nginx TLS; verification checklist |
| `MEDIA_GENERATION.md` | Media-tool decision tree, defaults, fallback chains, error handling; consistent with tools.ts |
| `AGENTS.md` | Dev commands, env, architecture, quirks (accurate) |
| `knowledge_base.md` | Compact global KB appended to system prompt at runtime (company lore, identity, rules) |
| `system_prompt.md` | Generated persona/rules prompt (835 lines, byte-identical to `make_prompt.cjs` template) |
| `make_prompt.cjs` | Generator script: single template literal written verbatim to `system_prompt.md`; run with `node make_prompt.cjs` |
| `task-page.html` | Standalone static demo mockup of a computer-use session ("Agent Execution Logs"); zero backend calls, unreferenced by app; added as demo artifact (commit 39a0425) |
| `install-server.sh` | Idempotent provisioning: apt toolchain, Playwright Chromium, OpenCode CLI, `.env.local`, data dirs, npm install/build, optional systemd unit |
| `Caddyfile` / `nginx-oss.conf` | Reverse-proxy TLS configs for `oss.eburon.ai` (WS upgrade headers present) |
| `.env.example` | `GEMINI_API_KEY` (placeholder), `PORT`, `APP_URL`, commented `GOOGLE_CLIENT_SECRET`; **no `DASHSCOPE_API_KEY`** |
| `metadata.json` | AI Studio applet metadata (camera+mic permissions, server-side Gemini API capability) |
| `index.html` | SPA shell → `/src/main.tsx` |
| `tsconfig.json` / `vite.config.ts` | Standard; `@/*` → root alias; HMR disabled via `DISABLE_HMR`; `allowedHosts` includes oss.eburon.ai |
| `google-web-credentials.json` | Gitignored real Google OAuth client (id + secret) — present on disk |

### Firebase artifacts
| File | Notes |
|---|---|
| `firebase-applet-config.json` | Committed public Firebase web config (apiKey, project `beatrice-os`, RTDB URL, `oAuthClientId`) |
| `firebase-blueprint.json` | Schema for `transcripts`, `tool_logs`, `user_configs` |
| `firestore.rules` | Per-user owner rules (default deny) — sane |
| `database.rules.json` | RTDB rules; `whatsapp_store` fully denied to clients; `saved_sessions` included |

### Server code
| File | Lines | Role |
|---|---|---|
| `server.ts` | 1987 | Express + WS `/live` + Gemini Live session + 67-way tool dispatch + REST routes + service boot |
| `server/tools.ts` | 1158 | Core tool handlers (sandbox, CLI, agents, QwenCloud, video, weather, search, canvas) |
| `server/googleWorkspace.ts` | 677 | 30 Google Workspace handlers — **all mocks, no real API calls** |
| `server/whatsapp-tools.ts` | 2124 | Full Baileys WhatsApp integration (session, pairing, store, 18 tools, 70-action dead catalog) |
| `server/toolProxy.ts` | 85 | Cached WS proxy `sendToService` + dead `closeAllServiceConnections` |
| `server/services/*` | 5–263 each | sandboxService :5556, cliService :5557, browserService :5558, computerService :5559, codingAgentService :5560 |

### Client code (`src/`)
| File | Lines | Role |
|---|---|---|
| `main.tsx` | 14 | Entry: `<AuthProvider><App/>` in StrictMode |
| `App.tsx` | 1786+ | Monolith: WS lifecycle (exponential backoff), audio/video capture, transcripts, tool state, Firebase sync, modals |
| `types.ts` | 233 | Shared types; `WsClientMessage` under-approximates messages App actually sends |
| `context/AuthContext.tsx` | 86 | Firebase Auth (Google popup w/ broad scopes, email/password, logout) |
| `index.css` | 152 | Tailwind v4 theme tokens + component classes (`.b-modal`, `.b-card`, …) |
| `lib/audioUtils.ts` | 331 | `AudioController`: mic→16kHz PCM16 base64, 24kHz playback queue, VAD, barge-in |
| `lib/videoUtils.ts` | 153 | `VideoController`: camera/screen→JPEG base64 ≤2 FPS |
| `lib/sessionMemory.ts` | 98 | localStorage config/transcript/summary persistence |
| `lib/firebase.ts` | 91 | Firebase init + (unused) helpers; server imports `uploadMediaToFirebaseStorage` from here |
| `lib/gmailHelper.ts` / `lib/contactsHelper.ts` | 242/232 | Real Google REST calls w/ fallbacks (see §6 fake-success issue) |
| `components/*` | 17 files | UI surfaces (see §4) |

---

## 3. Server architecture (server.ts)

- **Boot:** loads dotenv (`.env` then `.env.local` override) → starts 5 tool services → Express + `noServer` WS. Upgrade handler accepts only `/live` (server.ts:1011-1031). Fatal `EADDRINUSE` exits process (server.ts:1955-1978) — single-instance enforcement.
- **Live session:** `ai.live.connect` with hardcoded model `gemini-3.1-flash-live-preview`, voice default **Aoede**, `responseModalities: [AUDIO]`, input+output transcription, `tools: getFunctionDeclarations()` (67 declarations). System instruction = `system_prompt.md` + `knowledge_base.md` + session-continuity block (language, memory summary, last 16 turns) + WhatsApp live context (server.ts:1242-1321).
- **Resilience:** 1.5 s bootstrap delay; auto-retry on error/close up to 5× preserving language+memory; soft restart on prefs update; WhatsApp recent-context injection.
- **Tool dispatch:** serialized if/else chain (server.ts:1470-1625) — every path broadcasts `toolCall`/`toolResult` and sends `functionResponses` back to Gemini. Unknown tools return `{error: "Unknown tool name"}`.
- **Client WS protocol:** handles `sessionBootstrap`, `restartLive`, `updateSessionPrefs`, `audio` (16kHz PCM16), `video` (JPEG), `text`+`attachment`, `whatsappApproval`, plus manual triggers `runSandbox`, `runCli`, `deployAgent`, `getSystemInfo`, `updateCanvas`, `getWeather`, `webSearch`, `runSandboxStream`, `runCliStream`, `runBrowser`, `runComputer`, `runCodingAgent`, `cancelCodingAgent` (server.ts:1725-1887).
- **REST:** `/api/health`, `/api/services`, `/api/tools/{execute-code,cli,agent,canvas,weather,search}`, `/api/workspace/{gmail,contacts,forms}`, `/api/whatsapp/{status,capabilities,pair,pair-qr,cancel,logout,approve}`, `/api/sandbox/preview/:file` proxy.
- **Serving:** dev = Vite middleware; prod = static `dist/` + SPA fallback.

---

## 4. Client architecture

- **`App.tsx` monolith:** gates (intro video → auth/guest), WS connect with exponential backoff (1 s→30 s + jitter, max 10), `sessionBootstrap` on open (language, voice, persona, summary, last 16 turns), mic auto-start, transcript hydration from localStorage + RTDB (dedup, cap 80), per-tool state arrays (toolLogs, sandboxRuns, cliRuns, agentTasks, canvasData, browserSessions, computerSessions, codingAgentSessions, videoTasks, qwenTasks, waStatus, waApproval), modals/drawers, Firebase RTDB writes for transcripts/tool logs/user configs/saved sessions.
- **Audio:** `ScriptProcessorNode` (deprecated) → VAD → base64 PCM16 per ~256 ms chunk; playback via scheduled 24 kHz buffers with barge-in.
- **Video:** `getUserMedia`/`getDisplayMedia` → canvas → JPEG ≤2 FPS.
- **UI surfaces:** `SettingsModal` (voice/language/VAD/WhatsApp pairing/tool toggles), `ProfileModal`, `MemoryInspectorModal`, `TasksPage`, `ToolsWorkbench` (14 tabs: Function Calls, Workspace, Gmail, Contacts, Forms, Sandbox, Terminal, Sub-Agents, Canvas, Web Use, Computer Use, Coding Agent, Video Gen, QwenCloud), `TranscriptsView`, `VideoFeed`, `WhatsAppPanel`, `AuthPage`, `MobileOrb`.
- **Google workspace:** real API calls are **client-side only** (gmailHelper/contactsHelper with bearer token from Firebase Google auth), falling back to `/api/workspace/*` (which are mocks) and then to hardcoded fake data.

---

## 5. Tool inventory (67 registered in server.ts)

**Core (16):** executeCodeSandbox (JS/TS vm + python3 + HTML preview, service w/ in-process fallback), runCliCommand (pty via cliService w/ exec fallback), deployAgentTask (**fake sub-agent** — one Gemini text call + theatrical progress), runCodingAgent (spawns OpenCode CLI, default `/root/.opencode/bin/opencode`, model `opencode/deepseek-v4-flash-free` from global config), getSystemInfo, updateCanvasVisual, getWeather (**hardcoded fake weather**), webSearch (Gemini grounding, else placeholder text), qwenChat, qwenImageGenerate, qwenImageEdit, qwenVideoGenerate, qwenTts, generateVideo (**duplicate** of qwenVideoGenerate with own polling), runBrowserAutomation, runComputerControl.

**Google Workspace (30, server-side all mock):** createGoogleMeet (fabricates random Meet URL), Gmail (list/send/get/trash/delete/modify/draft), Calendar (list/create/update/delete), Drive (list/search/get/create/update/delete), Docs/Sheets/Slides/Forms create, Tasks (list/create/update/delete), Contacts (list/create/update/delete), searchYoutube, connectGoogleAccount — every one returns canned/fabricated data; **zero real Google API calls in googleWorkspace.ts**.

**WhatsApp (18):** resolve_whatsapp_contact, request_whatsapp_send, send_whatsapp_text/contact_card/message/group_message/document, read_whatsapp_chats, get_whatsapp_contacts/groups/message_history/calls, block/unblock, read_whatsapp_attachment, transcribe_whatsapp_audio (Gemini `gemini-2.5-flash`), sync_whatsapp_history (**no-op**), whatsapp_call (honestly reports unsupported). Backed by real Baileys session: pairing (QR + code), auth persisted to `data/whatsapp-auth`, store (300 msgs/chat, 200 calls) persisted debounced to RTDB + local file, reconnect backoff (5 s→120 s ×10), ban/logout detection, heartbeat, send-approval gate (`WHATSAPP_SEND_AUTO_APPROVE`, default **true** = auto-approve), incoming-message broadcast (200-char text).

**Media (QwenCloud/DashScope):** fallback chains implemented in tools.ts: images `wan2.7-image-pro` → `wan2.7-image`; video `happyhorse-1.1-t2v` → `wan3.0-video` → `wan2.7-t2v` → `wan2.6-t2v`; TTS `qwen3-tts-flash` → `qwen3-tts`. Results uploaded to Firebase Storage; async polling (video 60×5 s, image 40×3 s); model name included in broadcasts.

---

## 6. Findings — security

**Critical: no authentication anywhere on the server.** Anyone reaching port 5555 can:
- Execute arbitrary shell commands (`POST /api/tools/cli`, sandbox python, computerService `shell`, cliService pty — all run with full privileges and inherited env including `GEMINI_API_KEY`/`DASHSCOPE_API_KEY`).
- Pair/logout/approve WhatsApp (`/api/whatsapp/pair|logout|approve` unauthenticated), read/delete chats via tools.
- Trigger paid media generation.

Other security issues:
- **Path traversal / arbitrary file read:** `send_whatsapp_document` and media sends accept any server `filePath` (whatsapp-tools.ts:1525, 1709, 1980, 2035) — the model can exfiltrate `.env.local` or `/etc/passwd`.
- **Command injection:** computerService interpolates raw values into `xdotool key ${msg.key}` / `mousemove` (computerService.ts:111,118).
- **SSRF:** browserService navigates anywhere (no allowlist) — includes cloud metadata (169.254.169.254) and internal ports; page text flows back to the model.
- **XSS surface:** sandbox HTML previews served unauthenticated at `/api/sandbox/preview/:file` — stored LLM-generated HTML.
- **Broad Google OAuth scopes** (full Gmail, Drive, Calendar, Tasks, Contacts) requested on an auth gate that offers "Continue as guest".
- **Fake-success fallbacks (trust issues):** gmailHelper returns `messageId: 'sent_...'` when send actually failed (UI shows "Sent via Gmail!"); contactsHelper fabricates contacts; GoogleFormsTool "submits" responses locally only; ToolsWorkbench generates random Meet URLs client-side. Users are told real side effects occurred when none did.
- **WhatsApp data to Gemini:** up to 8 recent chat messages injected into the system prompt.
- **Secrets:** `firebase-applet-config.json` committed (public web key — normal but note); real OAuth secret only in gitignored `google-web-credentials.json`; hardcoded service-account path `/opt/beatrice-services/beatrice-os-service-account.json` (whatsapp-tools.ts:214).
- **Resource leaks:** unbounded Maps in all 5 services; Chromium/ptys never killed on client disconnect; no rate limiting/concurrency caps (multiple opencode processes, unbounded sessions).
- `runCliCommand` etc. are **command execution by design** — inherent risk, mitigated only by loopback trust assumptions.

---

## 7. Findings — bugs & dead code

### Real bugs
1. **CLI tool always 15 s timeout via service:** cliService emits `done:true` only on shell exit, never per-command (cliService.ts:55-58) — every `runCliCommand` through the service path resolves on the 15 s timeout.
2. **TS-stripping regex corrupts code:** `code.replace(/:\s*[A-Za-z0-9_<>\[\]]+(?=[,=;\)\n])/g,'')` mangles ternaries (`a ? x : b` → `a ? x b`) (tools.ts:146, sandboxService.ts:67).
3. **`firebaseUrls`/`firebaseAudioUrl` type mismatch:** ToolsWorkbench reads fields absent from `QwenCloudTask`; undetected because **`@types/react` is missing** from dependencies — `npm run lint` (tsc) silently can't typecheck React components (verified: TS2339 with explicit annotations).
4. **`generateVideo` duplicates `qwenVideoGenerate`** — two registered tools doing the same thing.
5. **googleWorkspace.ts is 100% mock** — the model is told these are real (README.md:7 "nothing simulated").
6. **`getWeather`/`webSearch` fabricate data** when keyless — misleading model and user.
7. **`sync_whatsapp_history` is a no-op** while system_prompt.md:591 instructs "ALWAYS RESYNC FIRST".
8. **Model-name inconsistencies:** `gemini-3.6-flash` (tools.ts:334,1139) and `gemini-2.5-flash` (whatsapp-tools.ts:1491) vs live `gemini-3.1-flash-live-preview`; qwenChat default `qwen3.7-plus` vs description `qwen3.8-max` (server.ts:235).
9. **`set_push_name` passes wrong JID** to `chatModify` (whatsapp-tools.ts:2047).
10. **Prompt contradictions:** system_prompt.md:599 ("don't use request_whatsapp_send") vs :639 (send flow requires it); md:684-685 mandatory defaults contradict both MEDIA_GENERATION.md and md:666-667 (video model/defaults).
11. **Voice enum mismatch:** app default `Aoede` is excluded from `voiceName` enums in firestore.rules:58 / database.rules.json:34 / firebase-blueprint.json:64.
12. **PDF attachments read as text** (TranscriptsView.tsx:71); no file-size limit → giant WS frames.
13. **Dead/inert UI:** Settings tool toggles are cosmetic (never sent to server); Memory Inspector has no launcher (ContextWindowHUD/VadControlWidget imported but never rendered); "Inspect Frame"/"Draft Email"/"AI Email Drafter" (keyword-matching stub) are fake; TasksPage `isPageVisible` dead state.
14. **Fake Meet URLs** (ToolsWorkbench.tsx:528-536) may point to someone else's room.
15. **`whatsappIncomingMessages` handler is empty** — incoming messages received then dropped (App.tsx:592-593).

### Dead code
- `runInternalWhatsAppAction` + 70-action `WA_INTERNAL_ACTIONS` catalog (never dispatched; only feeds `/api/whatsapp/capabilities`).
- `closeAllServiceConnections` (toolProxy.ts:76).
- Client: `OrbVisualizer`, `Header` (also shows stale model `eburon-3.1-flash-live`), `takeSnapshot`, `testConnection`/`handleFirebaseError`/`OperationType`/`uploadMediaToFirebaseStorage` (client-side), `isPartial` fields, `onSelectContact`/`onSendEmail`/`onEmailSent` props, `preventMultiTouch` zoom blockers.
- Two parallel proxy implementations: `forwardToService` (new socket per call, tools.ts) vs `sendToService` (cached, toolProxy.ts).

---

## 8. Findings — consistency & ops

- **Docs are largely accurate** (APP_LOGIC.md, DEPLOYMENT.md, MEDIA_GENERATION.md, AGENTS.md) — traced to code and verified.
- **Stale packaging:** package.json name `react-example`; `bun.lock` present but npm canonical; `npm run clean` targets stale `server.js`.
- **Uncommitted working-tree changes** (12 files, +605/−234): model-shuffle fallbacks (tools.ts), computer service enhancements, WhatsApp hardening, TasksPage rewrite with new untracked `src/components/ExecutionViewport.tsx` (~36 KB) — **in-flight feature work, not yet committed**.
- **Prompt hygiene:** `make_prompt.cjs` and `system_prompt.md` are in sync (byte-identical body); regenerate after template edits and restart server (loaded on WS connect).
- **Deployment:** prod = `node dist/server.cjs` on 5555 behind Caddy (recommended) or Nginx; single instance only; `data/` gitignored; WhatsApp pairing + Google connect + opencode auth are manual post-install steps.
- **No tests, no CI, no ESLint** — `tsc --noEmit` is the only gate and it has the @types/react blind spot (§7.3).

---

## 9. Recommendation priorities

1. **Harden auth** (token/secret on REST+WS, or bind behind auth proxy) — current exposure allows RCE/WhatsApp takeover.
2. **Fix fake-success paths** (Gmail/Contacts/Forms/Meet) — either implement server-side Google OAuth (server has `google-web-credentials.json` + firebase-admin) or fail loudly.
3. **Add `@types/react`** so `npm run lint` actually checks components; fix the `firebaseUrls` mismatch.
4. **Fix CLI `done` semantics** (emit per-command completion) — removes the 15 s stall on every CLI call.
5. **Remove duplicate `generateVideo`** or differentiate it clearly.
6. **Gate filePath media sends** to `data/whatsapp-media/`; **shell-quote** xdotool args; **allowlist browser** navigation.
7. **Resolve prompt contradictions** (request_whatsapp_send flow; video defaults) and resync `make_prompt.cjs` → restart.
8. **Clean dead code** (70-action WhatsApp catalog, duplicate proxies, unused components) and commit the in-flight working-tree changes consciously.
